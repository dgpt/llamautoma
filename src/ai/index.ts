// @ts-nocheck - Disable TypeScript checks as we're removing types
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { entrypoint, task } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { plannerTask } from './tasks/planner'
import { reviewerTask } from './tasks/reviewer'
import { fileOperationTask as coder } from './tasks/coder'
import { summarizerTask } from './tasks/summarizer'
import { intentTask } from './tasks/intent'
import { logger } from '@/logger'
import type { Message, WorkflowState, BaseResponse, Plan } from 'llamautoma-types'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { diffTool } from './tools/diff'
import { searchTool } from './tools/search'
import { extractTool } from './tools/extract'
import { runTool } from './tools/run'
import { evalTool } from './tools/eval'
import { fileTool } from './tools/file'
import { llm } from './llm'
import { getMessageString } from './tasks/lib'
import { RunnableConfig } from '@langchain/core/runnables'
import { MemorySaver } from '@langchain/langgraph/prebuilt'
import { TaskTypeSchema } from './tasks/schemas/tasks'
import { BidirectionalStreamHandler } from '../stream'
import { generateCompressedDiffs } from '../lib/diff'
import { compressAndEncodeMessage } from '../lib/compression'

// Convert Message to BaseMessage
function toBaseMessage(msg: Message): BaseMessage {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
  const additional = {
    name: msg.name,
    metadata: msg.metadata,
  }

  switch (msg.role.toLowerCase()) {
    case 'system':
      return new SystemMessage({ content, ...additional })
    case 'assistant':
      return new AIMessage({ content, ...additional })
    default:
      return new HumanMessage({ content, ...additional })
  }
}

// Convert BaseMessage to Message
function toMessage(msg: BaseMessage): Message {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
  return {
    role: msg instanceof SystemMessage ? 'system' : msg instanceof AIMessage ? 'assistant' : 'user',
    content,
    name: msg.name,
    metadata: msg.additional_kwargs,
  }
}

// Initialize tools
const tools = [diffTool, searchTool, extractTool, runTool, evalTool, fileTool]

// Create tool node
export const toolNode = new ToolNode(tools)

// Bind tools to LLM
const modelWithTools = llm.bindTools(tools)

// Create memory saver for workflow checkpointing
const checkpointer = new MemorySaver()

// Initialize stream handler
const streamHandler = new BidirectionalStreamHandler()

// Task to call model directly for chat
const chatTask = task('chat', async (messages: BaseMessage[]) => {
  const response = await modelWithTools.invoke(messages)
  return { messages: response }
})

// Task to handle tool calls
const toolTask = task('tools', async state => {
  const result = await toolNode.invoke(state)
  return result
})

/**
 * Main workflow that coordinates all tasks
 */
const workflow = entrypoint(
  { checkpointer, name: 'llamautoma' },
  async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
    // Determine intent first
    const intentResult = await intentTask.invoke(input, config)

    // If chat intent, return direct LLM response
    if (intentResult.type === 'chat') {
      return {
        type: 'chat',
        messages: input.messages,
        response: intentResult.response,
      }
    }

    // Check if we need to summarize (configurable threshold)
    let messages = input.messages
    if (messages.length > 10) {
      // TODO: Make configurable
      const summaryResult = await summarizerTask.invoke({ messages }, config)
      messages = summaryResult.messages
    }

    // Generate plan
    const planResult = await plannerTask.invoke({ messages }, config)

    // Review plan
    let planReviewResult = await reviewerTask.invoke(
      {
        messages,
        plan: planResult.plan,
      },
      config
    )

    // Retry planning if review fails (up to 3 times)
    let attempts = 0
    while (!planReviewResult.approved && attempts < 3) {
      const newPlanResult = await plannerTask.invoke(
        {
          messages: [
            ...messages,
            {
              type: 'system',
              content: `Previous plan rejected. Feedback: ${planReviewResult.feedback}`,
            },
          ],
        },
        config
      )

      planReviewResult = await reviewerTask.invoke(
        {
          messages,
          plan: newPlanResult.plan,
        },
        config
      )

      attempts++
    }

    // Generate code based on approved plan
    const codeResult = await coder.invoke(
      {
        messages,
        plan: planResult.plan,
      },
      config
    )

    // Generate compressed diffs for client
    const compressedDiffs = await generateCompressedDiffs(codeResult.files)

    // Review code
    let codeReviewResult = await reviewerTask.invoke(
      {
        messages,
        code: codeResult,
      },
      config
    )

    // Retry code generation if review fails (up to 3 times)
    attempts = 0
    while (!codeReviewResult.approved && attempts < 3) {
      const newCodeResult = await coder.invoke(
        {
          messages: [
            ...messages,
            {
              type: 'system',
              content: `Previous code rejected. Feedback: ${codeReviewResult.feedback}`,
            },
          ],
        },
        config
      )

      codeReviewResult = await reviewerTask.invoke(
        {
          messages,
          code: newCodeResult,
        },
        config
      )

      attempts++
    }

    // Prepare response for client
    const response = {
      type: 'code',
      messages,
      plan: planResult,
      code: {
        ...codeResult,
        diffs: compressedDiffs,
      },
      reviews: {
        plan: planReviewResult,
        code: codeReviewResult,
      },
    }

    // Compress response for client
    return compressAndEncodeMessage(response)
  }
)

// Export workflow with proper config handling
export const llamautoma = {
  invoke: async (input, config) => {
    const result = await workflow.invoke(
      { messages: input.messages || [] },
      {
        configurable: {
          thread_id: input.id || 'default',
          checkpoint_ns: 'llamautoma',
          ...config?.configurable,
        },
      }
    )
    return result
  },

  stream: async function* (input, config) {
    const stream = await workflow.stream(
      { messages: input.messages || [] },
      {
        configurable: {
          thread_id: input.id || 'default',
          checkpoint_ns: 'llamautoma',
          ...config?.configurable,
        },
        streamMode: 'values',
      }
    )

    for await (const chunk of stream) {
      // Compress streaming responses for client
      if (chunk.streamResponses) {
        for (const response of chunk.streamResponses) {
          yield {
            type: response.type,
            content: compressAndEncodeMessage(response.content),
            metadata: response.metadata,
            timestamp: response.timestamp,
          }
        }
      }

      // Compress final result for client
      if (chunk.type === 'complete') {
        yield {
          type: 'complete',
          content: compressAndEncodeMessage(chunk.content),
          metadata: chunk.metadata,
          timestamp: chunk.timestamp,
        }
      }
    }
  },
}

// Re-export tasks
export * from './tasks/intent'
export * from './tasks/planner'
export * from './tasks/coder'
export * from './tasks/reviewer'
export * from './tasks/summarizer'

// toolNode is already exported from './tools'
// export { toolNode } from './tools'

/**
 * Wraps a task execution with ReAct pattern for autonomous tool usage
 * @param prompt Initial prompt for the task
 * @param tools Tools available to the task
 * @param getStructuredResult Function to get final structured result
 */
export async function withReactTools<T>({
  prompt,
  tools,
  getStructuredResult,
}: {
  prompt: string
  tools: ToolNode
  getStructuredResult: (analysis: string) => Promise<T>
}): Promise<T> {
  // Add tool descriptions to prompt
  const promptWithTools = `${prompt}

You have access to these tools:

1. search: Search the codebase for patterns and similar code
   Input schema: {
     "query": string,  // The search query
     "target_directories"?: string[],  // Optional directories to search in
     "include_pattern"?: string,  // Optional glob pattern for files to include
     "exclude_pattern"?: string   // Optional glob pattern for files to exclude
   }

2. eval: Evaluate code for potential issues
   Input schema: {
     "code": string,  // The code to evaluate
     "context"?: string  // Optional context about the code
   }

3. run: Run shell commands (may require approval)
   Input schema: {
     "command": string,  // The command to run
     "cwd"?: string,  // Optional working directory
     "env"?: Record<string, string>  // Optional environment variables
   }

4. extract: Extract content from web pages
   Input schema: {
     "url": string,  // The URL to extract from
     "selector"?: string  // Optional CSS selector to extract specific content
   }

5. diff: Generate diffs between code versions
   Input schema: {
     "files": Array<{
       "path": string,  // File path
       "content": string,  // File content
       "type": "create" | "modify" | "delete"  // Operation type
     }>
   }

Think through what you need to check. Use tools to gather information before making your decision.
Use this format:
Thought: I need to check something
Action: {"tool": "tool_name", "input": <tool input schema>}
Observation: <r>
... (repeat Thought/Action/Observation as needed)
Final Answer: When ready to make your final decision, say "MAKE_RESULT" and I will prompt you for the structured result format.`

  // Start the ReAct loop
  let currentMessages = [new HumanMessage(promptWithTools)]
  let analysis = ''

  while (true) {
    const llmResponse = await llm.invoke(currentMessages)
    const responseStr = getMessageString(llmResponse)
    currentMessages.push(llmResponse)
    analysis += responseStr + '\n'

    // Check if ready for final result
    if (responseStr.includes('MAKE_RESULT')) {
      return await getStructuredResult(analysis)
    }

    // Extract and execute tool call
    if (responseStr.includes('Action:')) {
      const action = JSON.parse(responseStr.split('Action:')[1].split('\n')[0].trim())
      const observation = await tools.invoke(action)
      currentMessages.push(new HumanMessage(`Observation: ${JSON.stringify(observation.output)}`))
    } else {
      // If no action found but also no final answer, prompt for next step
      currentMessages.push(
        new HumanMessage(
          'What would you like to check next? Use tools to gather information or say "MAKE_RESULT" when ready to provide your final result.'
        )
      )
    }
  }
}
