import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { entrypoint, task, MemorySaver } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { plannerTask } from './tasks/planner'
import { reviewerTask } from './tasks/reviewer'
import { coderTask } from './tasks/coder'
import { summarizerTask } from './tasks/summarizer'
import { logger } from '@/logger'
import type { Message, WorkflowState, BaseResponse } from 'llamautoma-types'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { DiffTool } from './tools/diff'
import { SearchTool } from './tools/search'
import { ExtractTool } from './tools/extract'
import { RunTool } from './tools/run'
import { llm } from './llm'

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

// Initialize tools and bind them to LLM
const config: Partial<RunnableConfig> = {
  runName: 'llamautoma_tool',
  callbacks: undefined,
  metadata: { llm },
  tags: ['llamautoma'],
}

// Initialize and bind all tools
const tools = {
  diff: new DiffTool().bind(config),
  search: new SearchTool().bind(config),
  extract: new ExtractTool().bind(config),
  run: new RunTool().bind(config),
}

// Register tools with LLM
llm.bind({
  ...config,
  tools: Object.values(tools),
})

// Create workflow tasks
const summarizeContext = task('summarizeContext', async (messages: Message[]) => {
  if (messages.length <= 10) return { messages }
  const baseMessages = messages.map(toBaseMessage)
  const summary = await summarizerTask({ messages: baseMessages })
  return { messages: Array.from(summary.messages).map(msg => toMessage(msg)) }
})

// Create workflow
export const workflow = entrypoint(
  {
    name: 'llamautoma',
    checkpointer: new MemorySaver(),
  },
  async (input: WorkflowState): Promise<BaseResponse> => {
    // Initialize state
    let messages = input.messages || []
    let iterations = 0
    const maxIterations = DEFAULT_CONFIG.maxIterations

    try {
      // Check iterations
      if (iterations >= maxIterations) {
        return {
          status: 'error',
          error: `Max iterations (${maxIterations}) reached`,
          metadata: {
            messages,
            iterations,
            threadId: input.id,
          },
        }
      }

      // Summarize context if needed
      const summary = await summarizeContext(messages)
      messages = summary.messages

      // Generate plan with tools context
      const baseMessages = messages.map(toBaseMessage)
      const plan = await plannerTask({
        messages: baseMessages,
        feedback: {
          approved: false,
          feedback: `Available tools: ${Object.keys(tools).join(', ')}`,
        },
      })

      // If plan doesn't have steps, it's just a chat response
      if (!plan.steps?.length) {
        return {
          status: 'success',
          metadata: {
            messages,
            iterations,
            threadId: input.id,
            response: plan.response,
          },
        }
      }

      // Review plan with tools context
      const planReview = await reviewerTask({
        messages: baseMessages,
        plan,
      })
      if (!planReview.approved) {
        return {
          status: 'error',
          error: planReview.feedback || 'Plan review failed',
          metadata: {
            messages,
            iterations,
            threadId: input.id,
          },
        }
      }

      // Generate code with tools context
      const code = await coderTask({
        messages: baseMessages,
        plan,
        feedback: {
          approved: false,
          feedback: `Available tools: ${Object.keys(tools).join(', ')}`,
        },
      })

      // Review code with tools context
      const codeReview = await reviewerTask({
        messages: baseMessages,
        code,
      })
      if (!codeReview.approved) {
        return {
          status: 'error',
          error: codeReview.feedback || 'Code review failed',
          metadata: {
            messages,
            iterations,
            threadId: input.id,
          },
        }
      }

      // Generate diffs using diff tool
      const diffs = await tools.diff.invoke({ files: code.files })

      // Return success
      return {
        status: 'success',
        metadata: {
          messages,
          iterations,
          threadId: input.id,
          diffs,
          type: 'code',
        },
      }
    } catch (error) {
      logger.error('Workflow error:', error)
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          messages,
          iterations,
          threadId: input.id,
        },
      }
    }
  }
)

// Export workflow with proper config handling
export const llamautoma = {
  workflow,
  invoke: async (input: WorkflowState, config?: Partial<RunnableConfig>): Promise<BaseResponse> => {
    return await workflow.invoke(input, {
      ...config,
      configurable: {
        thread_id: input.id,
        ...config?.configurable,
      },
    })
  },
  stream: async function* (input: WorkflowState, config?: Partial<RunnableConfig>) {
    const stream = await workflow.stream(input, {
      ...config,
      configurable: {
        thread_id: input.id,
        ...config?.configurable,
      },
    })

    for await (const chunk of stream) {
      yield chunk
    }
  },
}
