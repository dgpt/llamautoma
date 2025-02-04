import { SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { logger, startTimer, endTimer, logAgentResponse, logError } from '@/logger'
import {
  AgentInput,
  AgentOutput,
  FunctionalReActConfig,
  ReActResponseSchema,
  AgentConfigurable,
} from '@/types/agent'
import AGENT_TOOLS from '@/agents/tools'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { FunctionalReActConfigSchema } from '@/types/agent'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { entrypoint, task } from '@langchain/langgraph'
import { LoggedChatOllama } from '@/clients/ollama'

const SYSTEM_PROMPT = `You are an advanced AI assistant designed to solve tasks systematically and safely.
Your responses MUST ALWAYS be in a structured JSON format with a type field.

Guidelines:
1. Break down complex tasks into manageable steps
2. Use available tools strategically and safely
3. Provide clear, step-by-step reasoning

IMPORTANT:
- For calculations, use the typescript-execution tool
- When using typescript-execution, ALWAYS use explicit 'return' statements to return the result
- For tool usage, ALWAYS wait for confirmation when required
- For tool execution, ALWAYS provide feedback when required

Response format MUST be one of:
{
  "type": "thought",
  "content": "Your reasoning here"
}

{
  "type": "chat",
  "content": "Your message here"
}

{
  "type": "tool",
  "thought": "Why you're using the tool",
  "action": "tool-name",
  "args": { "arg1": "value1" }
}

{
  "type": "final",
  "content": "Your final answer here"
}

Example:
User: What is 2 + 2?
Assistant: {
  "type": "thought",
  "content": "I'll solve this basic arithmetic problem"
}
{
  "type": "tool",
  "thought": "Let me verify the calculation",
  "action": "typescript-execution",
  "args": { "code": "return 2 + 2" }
}
{
  "type": "chat",
  "content": "2 + 2 equals 4"
}`

export function createReActAgent(config: FunctionalReActConfig) {
  // Validate config using zod schema
  const validatedConfig = FunctionalReActConfigSchema.parse(config)

  // Initialize memory persistence and chat model
  const memorySaver = validatedConfig.memoryPersistence || new MemorySaver()
  const chatModel =
    validatedConfig.chatModel ||
    new LoggedChatOllama({
      model: validatedConfig.modelName || DEFAULT_AGENT_CONFIG.modelName,
      baseUrl: validatedConfig.host || DEFAULT_AGENT_CONFIG.host,
    })

  // Configure tools
  const agentTools = AGENT_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    func: async (input: Record<string, unknown>) => {
      try {
        return await tool.invoke(input)
      } catch (error) {
        logger.error('Tool execution failed', { tool: tool.name, error })
        throw error
      }
    },
  }))

  // Create model task
  const callModel = task(
    'callModel',
    async (messages: BaseMessage[], runConfig?: RunnableConfig) => {
      return await chatModel.invoke(messages, runConfig)
    }
  )

  // Create tool execution task
  const executeToolTask = task(
    'executeToolTask',
    async (toolCall: { action: string; args: Record<string, unknown> }) => {
      const tool = agentTools.find(t => t.name === toolCall.action)
      if (!tool) throw new Error(`Tool ${toolCall.action} not found`)
      return await tool.func(toolCall.args)
    }
  )

  // Helper to format response as JSON
  const formatResponse = (content: string): string => {
    try {
      // Check if it's already valid JSON
      JSON.parse(content)
      return content
    } catch {
      // If not JSON, wrap in a chat response
      return JSON.stringify({
        type: 'chat',
        content: content.trim(),
      })
    }
  }

  // Create the agent workflow
  const workflow = entrypoint(
    { checkpointer: memorySaver, name: 'react_agent' },
    async (inputs: AgentInput) => {
      const { messages, configurable } = inputs
      const threadId = configurable?.thread_id || Bun.randomUUIDv7()
      startTimer(threadId)

      const agentConfigurable: AgentConfigurable = {
        thread_id: threadId,
        checkpoint_ns: configurable?.checkpoint_ns || 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      }

      const systemMessage = new SystemMessage(SYSTEM_PROMPT)
      const allMessages: BaseMessage[] = [systemMessage, ...messages]
      let status: 'continue' | 'end' = 'continue'
      let toolFeedback = {}
      let iterations = 0

      try {
        const result = await callModel(allMessages, { configurable: agentConfigurable })
        const formattedContent = formatResponse(result.content.toString())
        const response = JSON.parse(formattedContent)

        if (ReActResponseSchema.safeParse(response).success) {
          if (response.type === 'tool' && response.action === 'typescript-execution') {
            const toolResult = await executeToolTask(response)
            toolFeedback = { executionResult: toolResult, executionSuccess: true }
            allMessages.push(
              new AIMessage(
                JSON.stringify({
                  type: 'chat',
                  content: `${response.args.code} equals ${toolResult}`,
                })
              )
            )
          } else {
            allMessages.push(result)
          }
          status = response.type === 'thought' ? 'continue' : 'end'

          const elapsedMs = endTimer(threadId)
          logAgentResponse(
            threadId,
            response.type,
            response.content || response.thought || '',
            elapsedMs
          )
        } else {
          allMessages.push(
            new AIMessage(
              JSON.stringify({
                type: 'chat',
                content: result.content.toString(),
              })
            )
          )
          status = 'end'

          const elapsedMs = endTimer(threadId)
          logAgentResponse(threadId, 'chat', result.content.toString(), elapsedMs)
        }

        return {
          messages: allMessages,
          status,
          toolFeedback,
          iterations,
          threadId,
          configurable: agentConfigurable,
        }
      } catch (error) {
        logError(threadId, error instanceof Error ? error.message : String(error))
        throw error
      }
    }
  )

  return {
    invoke: async (input: AgentInput, runConfig?: RunnableConfig): Promise<AgentOutput> => {
      const threadId =
        runConfig?.configurable?.thread_id ||
        validatedConfig.threadId ||
        input.configurable?.thread_id ||
        Bun.randomUUIDv7()

      const baseConfigurable: AgentConfigurable = {
        thread_id: threadId,
        checkpoint_ns: input.configurable?.checkpoint_ns || 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      }

      try {
        return await workflow.invoke(
          { messages: input.messages, configurable: baseConfigurable },
          { configurable: baseConfigurable }
        )
      } catch (error) {
        logError(threadId, error instanceof Error ? error.message : String(error))
        throw error
      }
    },
  }
}
