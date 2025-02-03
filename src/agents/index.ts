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
} from '@/types/agent'
import { convertToBaseReActTool } from '@/agents/tools/baseTool'
import AGENT_TOOLS from '@/agents/tools'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { v4 as uuidv4 } from 'uuid'
import { FunctionalReActConfigSchema } from '@/types/agent'

const SYSTEM_PROMPT = `You are an advanced AI assistant designed to solve tasks systematically and safely.
Your responses MUST ALWAYS be in a structured format.

Guidelines:
1. Break down complex tasks into manageable steps
2. Use available tools strategically and safely
3. Provide clear, step-by-step reasoning

IMPORTANT:
- For calculations, ALWAYS use the calculator tool
- For dangerous operations, ALWAYS explain why they are unsafe
- For tool usage, ALWAYS wait for confirmation when required
- For tool execution, ALWAYS provide feedback when required
- ALWAYS stop if safety checks fail

Available tools:
{tools}`

export function createReActAgent(config: FunctionalReActConfig) {
  // Validate config using zod schema
  const validatedConfig = FunctionalReActConfigSchema.parse(config)

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

  // Convert provided tools or use defaults
  const agentTools = validatedConfig.tools
    ? validatedConfig.tools.map(convertToBaseReActTool)
    : AGENT_TOOLS.map(convertToBaseReActTool)

  // Create the ReAct agent with structured response format
  const agent = createReactAgent({
    llm: chatModel,
    tools: agentTools,
    responseFormat: {
      schema: ReActResponseSchema,
      prompt:
        'Always return responses in the JSON format specified by the schema. For tool calls, include thought process and arguments. For final answers, include clear explanations.',
    },
  })

  // Add system message to the agent's messages
  const systemMessage = new SystemMessage(
    SYSTEM_PROMPT.replace('{tools}', agentTools.map(t => `${t.name}: ${t.description}`).join('\n'))
  )

  return {
    invoke: async (input: AgentInput, runConfig?: RunnableConfig): Promise<AgentOutput> => {
      // Create base configurable for thread persistence
      const baseConfigurable = {
        thread_id:
          runConfig?.configurable?.thread_id ||
          validatedConfig.threadId ||
          input.configurable?.thread_id ||
          uuidv4(),
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable' as const,
      }

      // Execute agent with input
      const result = await agent.invoke(
        {
          messages: [systemMessage, ...input.messages],
        },
        runConfig
      )

      // Parse the last message to determine status
      const lastMessage = result.messages[result.messages.length - 1]
      let status: 'continue' | 'end' = 'continue'
      try {
        const response = JSON.parse(lastMessage.content.toString())
        if (ReActResponseSchema.safeParse(response).success && response.type === 'final') {
          status = 'end'
        }
      } catch {
        // If we can't parse the JSON, default to continue
        status = 'continue'
      }

      // Return output with structured response
      return {
        messages: result.messages,
        status,
        toolFeedback: {},
        iterations: 0,
        threadId: baseConfigurable.thread_id,
        configurable: baseConfigurable,
      }
    },
  }
}
