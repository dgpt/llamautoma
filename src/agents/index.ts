import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOllama } from '@langchain/ollama'
import { SystemMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { logger } from '@/logger'
import {
  AgentInput,
  AgentOutput,
  FunctionalReActConfig,
  SafetyConfig,
  ReActResponseSchema,
  AgentConfigurable,
} from '@/types/agent'
import AGENT_TOOLS from '@/agents/tools'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { v4 as uuidv4 } from 'uuid'
import { FunctionalReActConfigSchema } from '@/types/agent'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { entrypoint, task } from '@langchain/langgraph'

const SYSTEM_PROMPT = `You are an advanced AI assistant designed to solve tasks systematically and safely.
Your responses MUST ALWAYS be in a structured format.

Guidelines:
1. Break down complex tasks into manageable steps
2. Use available tools strategically and safely
3. Provide clear, step-by-step reasoning
4. Always include TypeScript in your responses when discussing code or programming concepts

IMPORTANT:
- For TypeScript code execution, use the typescript-execution tool
- Use typescript-execution tool to perform math or any other calculations
- For dangerous operations, ALWAYS explain why they are unsafe
- For tool usage, ALWAYS wait for confirmation when required
- For tool execution, ALWAYS provide feedback when required

Available tools:
{tools}`

export function createReActAgent(config: FunctionalReActConfig) {
  // Validate config using zod schema
  const validatedConfig = FunctionalReActConfigSchema.parse(config)

  // Initialize memory persistence
  const memorySaver = validatedConfig.memoryPersistence || new MemorySaver()

  // Initialize chat model
  const chatModel =
    validatedConfig.chatModel ||
    new ChatOllama({
      model: validatedConfig.modelName || DEFAULT_AGENT_CONFIG.modelName,
      baseUrl: validatedConfig.host || DEFAULT_AGENT_CONFIG.host,
    })

  logger.debug(
    {
      modelName: validatedConfig.modelName,
      host: validatedConfig.host,
    },
    'Created chat model'
  )

  // Validate chat model
  if (!chatModel.invoke || typeof chatModel.invoke !== 'function') {
    throw new Error('Invalid chat model: invoke method not found')
  }

  // Configure safety settings based on environment
  const safetyConfig: SafetyConfig =
    process.env.NODE_ENV === 'test'
      ? {
          ...DEFAULT_AGENT_CONFIG.safetyConfig,
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength,
          dangerousToolPatterns: DEFAULT_AGENT_CONFIG.safetyConfig.dangerousToolPatterns,
        }
      : {
          ...DEFAULT_AGENT_CONFIG.safetyConfig,
          ...(validatedConfig.safetyConfig || {}),
        }

  // Configure tools with proper error handling
  const agentTools = AGENT_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    func: async (input: Record<string, unknown>) => {
      try {
        const result = await tool.invoke(input)
        return result
      } catch (error) {
        logger.error('Tool execution failed', {
          tool: tool.name,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  }))

  // Create the model task
  const callModel = task(
    'callModel',
    async (messages: AgentInput['messages'], runConfig?: RunnableConfig) => {
      const result = await chatModel.invoke(messages, runConfig)
      return result
    }
  )

  // Create the agent workflow
  const workflow = entrypoint(
    {
      checkpointer: memorySaver,
      name: 'react_agent',
    },
    async (inputs: AgentInput) => {
      const { messages, configurable } = inputs
      const threadId = configurable?.thread_id || uuidv4()
      const agentConfigurable: AgentConfigurable = {
        thread_id: threadId,
        checkpoint_ns: configurable?.checkpoint_ns || 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      }

      const systemMessage = new SystemMessage(
        SYSTEM_PROMPT.replace(
          '{tools}',
          agentTools.map(t => `${t.name}: ${t.description}`).join('\n')
        )
      )

      // Execute model with system message and user messages
      const result = await callModel([systemMessage, ...messages], {
        configurable: agentConfigurable,
      })

      // Parse response and determine status
      let status: 'continue' | 'end' = 'continue'
      let toolFeedback = {}

      try {
        const response = JSON.parse(result.content.toString())
        if (ReActResponseSchema.safeParse(response).success) {
          if (response.type === 'final') {
            status = 'end'
          } else if (response.type === 'tool' && response.action === 'typescript-execution') {
            toolFeedback = {
              executionResult: response.args?.output || '',
              executionSuccess: !response.args?.error,
            }
          }
        }
      } catch {
        // If we can't parse the JSON, default to continue
        status = 'continue'
      }

      // Return structured output
      return {
        messages: [result],
        status,
        toolFeedback,
        iterations: 0,
        threadId,
        configurable: agentConfigurable,
      }
    }
  )

  return {
    invoke: async (input: AgentInput, runConfig?: RunnableConfig): Promise<AgentOutput> => {
      const threadId =
        runConfig?.configurable?.thread_id ||
        validatedConfig.threadId ||
        input.configurable?.thread_id ||
        uuidv4()

      const baseConfigurable: AgentConfigurable = {
        thread_id: threadId,
        checkpoint_ns: input.configurable?.checkpoint_ns || 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      }

      try {
        return await workflow.invoke(
          {
            messages: input.messages,
            configurable: baseConfigurable,
          },
          {
            configurable: baseConfigurable,
          }
        )
      } catch (error) {
        logger.error('Agent execution failed', {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  }
}
