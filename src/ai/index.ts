// @ts-nocheck - Disable TypeScript checks as we're removing types
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { entrypoint, task, MemorySaver } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { plannerTask } from './tasks/planner'
import { reviewerTask } from './tasks/reviewer'
import { fileOperationTask } from './tasks/coder'
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

// Create checkpointer for persistence
const checkpointer = new MemorySaver()

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

// Main workflow using functional API
const workflow = entrypoint(
  { checkpointer, name: 'llamautoma' },
  async (input: { messages: BaseMessage[] }) => {
    const { messages } = input

    // Determine intent
    const intent = await intentTask({ messages })

    // For chat requests, invoke LLM directly
    if (intent === 'chat') {
      return await chatTask(messages)
    }

    // For code generation, follow the evaluator-optimizer loop
    let currentMessages = messages

    // Check if we need to summarize (context too long)
    if (currentMessages.length > DEFAULT_CONFIG.maxContextLength) {
      const summary = await summarizerTask({ messages: currentMessages })
      currentMessages = summary.messages
    }

    // Planner -> Reviewer loop (max 10 iterations)
    let plan: Plan | undefined
    let planReview
    let planAttempts = 0

    while (planAttempts < DEFAULT_CONFIG.maxPlanAttempts) {
      plan = await plannerTask({ messages: currentMessages, review: planReview })
      planReview = await reviewerTask({ messages: currentMessages, plan })

      if (planReview.approved) break
      planAttempts++
    }

    // Process each step in the plan
    const results = []
    for (const step of plan.steps || []) {
      // Handle any tool calls first
      if (step.tool_calls) {
        for (const toolCall of step.tool_calls) {
          const toolResult = await toolNode.invoke(toolCall)
          results.push({
            type: 'tool_result',
            step: step.description,
            tool: toolCall.tool,
            result: toolResult,
          })
        }
      }

      // Handle file operations if present
      if (step.file) {
        const fileResult = await fileOperationTask({
          file: step.file,
          messages: currentMessages,
          config: input.config,
        })
        if (fileResult) {
          results.push({
            type: 'file_result',
            step: step.description,
            result: fileResult,
          })
        }
      }
    }

    // Generate final diff for all file modifications
    const filesToDiff = results.filter(r => r.type === 'file_result').map(r => r.result)

    const diff =
      filesToDiff.length > 0
        ? await toolNode.invoke({
            tool: 'diff',
            input: { files: filesToDiff },
          })
        : null

    return {
      messages: currentMessages,
      plan,
      results,
      diff,
    }
  }
)

// Export workflow with proper config handling
export const llamautoma = {
  invoke: async (input, config) => {
    // Convert input messages to BaseMessages
    const messages = (input.messages || []).map(toBaseMessage)

    // Run workflow
    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: input.id || 'default',
          checkpoint_ns: 'llamautoma',
          ...config?.configurable,
        },
      }
    )

    // Convert result messages back to regular messages
    return {
      status: 'success',
      metadata: {
        messages: result.messages.map(toMessage),
        threadId: input.id,
        plan: result.plan,
        results: result.results,
        diff: result.diff,
      },
    }
  },

  stream: async function* (input, config) {
    // Convert input messages to BaseMessages
    const messages = (input.messages || []).map(toBaseMessage)

    // Stream workflow
    const stream = await workflow.stream(
      { messages },
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
      yield {
        status: 'streaming',
        metadata: {
          messages: chunk.messages.map(toMessage),
          threadId: input.id,
          step: chunk.metadata?.step || 'processing',
          plan: chunk.plan,
          results: chunk.results,
          diff: chunk.diff,
        },
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
