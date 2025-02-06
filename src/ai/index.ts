import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { entrypoint, MemorySaver } from '@langchain/langgraph'
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

// Create workflow
export const workflow = entrypoint(
  {
    name: 'llamautoma',
    checkpointer: new MemorySaver(),
  },
  async (input: WorkflowState): Promise<BaseResponse> => {
    // Initialize state
    let messages = input.messages || []
    let planIterations = 0
    let codeIterations = 0
    const maxIterations = input.config?.maxIterations || DEFAULT_CONFIG.maxIterations
    const maxContextTokens =
      input.config?.memory?.maxContextTokens || DEFAULT_CONFIG.memory.maxContextTokens

    try {
      // Convert messages to base messages
      let baseMessages = messages.map(toBaseMessage)

      // Summarize context if needed
      const summary = await summarizerTask({ messages: baseMessages, maxContextTokens })
      baseMessages = summary.messages
      messages = baseMessages.map(msg => toMessage(msg))

      // Generate initial plan
      let plan = await plannerTask({ messages: baseMessages })

      // Plan review loop
      let planReview
      while (planIterations < maxIterations) {
        // Review plan
        planReview = await reviewerTask({
          messages: baseMessages,
          plan,
        })

        if (planReview.approved) break

        // Generate new plan with review feedback
        plan = await plannerTask({
          messages: baseMessages,
          review: {
            approved: false,
            feedback: planReview.feedback,
          },
        })

        planIterations++

        // Auto-pass at max iterations
        if (planIterations >= maxIterations) {
          logger.warn('Max plan iterations reached, auto-passing plan')
          break
        }
      }

      // Code generation loop
      let code = await coderTask({
        messages: baseMessages,
        plan,
      })

      // Code review loop
      let codeReview
      while (codeIterations < maxIterations) {
        // Review code
        codeReview = await reviewerTask({
          messages: baseMessages,
          code,
          plan,
        })

        if (codeReview.approved) break

        // Generate new code with review feedback
        code = await coderTask({
          messages: baseMessages,
          plan,
          review: {
            approved: false,
            feedback: codeReview.feedback,
          },
        })

        codeIterations++

        // Auto-pass at max iterations
        if (codeIterations >= maxIterations) {
          logger.warn('Max code iterations reached, auto-passing code')
          break
        }
      }

      // Generate diffs using diff tool
      const diffs = await tools.diff.invoke({ files: code.files })

      // Return success
      return {
        status: 'success',
        metadata: {
          messages,
          threadId: input.id,
          diffs,
          plan,
        },
      }
    } catch (error) {
      logger.error('Workflow error:', error)
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          messages,
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
