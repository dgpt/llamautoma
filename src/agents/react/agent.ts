import { entrypoint, task } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { ChatOllama } from '@langchain/ollama'
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { Tool } from '@langchain/core/tools'
import { RunnableConfig } from '@langchain/core/runnables'
import { logger } from '../../utils/logger'
import { AgentState, AgentInput, AgentOutput, FunctionalReActConfig } from '../../types/agent'
import { SafetyChecker } from './safety/safetyChecker'
import { ToolExecutor } from './tools/toolExecutor'
import { UserInteractionManager } from './interaction/userInteractionManager'
import { convertToBaseReActTool } from './tools/baseTool'

const SYSTEM_PROMPT = `You are an advanced AI assistant designed to solve tasks systematically and safely.

Guidelines:
1. Break down complex tasks into manageable steps
2. Use available tools strategically and safely
3. Provide clear, step-by-step reasoning
4. For each action, specify:
   - Thought: Your reasoning
   - Action: Tool name to use
   - Action Input: Precise input in valid JSON format
   - Observation: Result of the action
   Final Answer: [Your response]

IMPORTANT:
- Always use valid JSON for Action Input
- Wait for user confirmation when required
- Provide feedback after tool execution
- Stop if safety checks fail

Available tools:
{tools}`

const parseModelResponse = task('parse_model_response', async (content: string) => {
  const toolMatch = content.match(/Action: (\w+)\nAction Input: ({.+?})(?=\n|$)/s)
  if (!toolMatch || !toolMatch[1] || !toolMatch[2]) {
    return { success: false, error: 'Failed to parse model response' as const }
  }
  try {
    const toolArgs = JSON.parse(toolMatch[2])
    return { success: true, toolName: toolMatch[1], toolArgs }
  } catch (error) {
    return { success: false, error: 'Invalid JSON in tool arguments' as const }
  }
})

const createErrorState = (state: AgentState, errorMessage: string): AgentState => ({
  ...state,
  messages: [...state.messages, new AIMessage(errorMessage)],
  status: 'end',
  isFinalAnswer: true,
  modelResponse: new AIMessage(errorMessage),
  toolFeedback: state.toolFeedback,
  action: null,
  observation: null,
  userConfirmed: false
})

const executeAgentStep = task('execute_agent_step', async (state: AgentState): Promise<AgentState> => {
  try {
    const toolDescriptions = state.tools.map((tool: Tool) => `${tool.name}: ${tool.description}`).join('\n')
    const messages = [new SystemMessage(SYSTEM_PROMPT.replace('{tools}', toolDescriptions)), ...state.messages]

    const modelResponse = await state.chatModel.invoke(messages, {
      signal: state.configurable?.signal,
    })

    const content = modelResponse.content.toString()
    if (content.includes('Final Answer:')) {
      return {
        ...state,
        messages: [...state.messages, new AIMessage(content)],
        status: 'end',
        isFinalAnswer: true,
        modelResponse: new AIMessage(content),
        toolFeedback: state.toolFeedback
      }
    }

    const parseResult = await parseModelResponse(content)
    if (!parseResult.success) {
      return createErrorState(state, parseResult.error || 'Failed to parse model response')
    }

    const toolName = parseResult.toolName || ''
    const toolArgs = parseResult.toolArgs || ''
    const tool = state.tools.find((t) => t.name === toolName)
    if (!tool) {
      return createErrorState(state, `Tool '${toolName}' not found`)
    }

    const safetyResult = await SafetyChecker.runSafetyChecks(toolName, toolArgs, state.safetyConfig)
    if (!safetyResult.passed) {
      return createErrorState(state, `Tool execution blocked: ${safetyResult.reason || 'Safety check failed'}`)
    }

    if (state.safetyConfig?.requireToolConfirmation) {
      const confirmationState = await UserInteractionManager.requestToolConfirmation(state, toolName, toolArgs)
      if (!confirmationState.userConfirmed) {
        return createErrorState(state, 'Tool execution rejected by user')
      }
    }

    const { result, newState } = await ToolExecutor.executeTool(state, tool, toolArgs)
    const toolOutput = result.output || 'No output from tool'
    const updatedState: AgentState = {
      ...state,
      ...newState,
      messages: [...state.messages, new AIMessage(toolOutput)],
      status: result.success ? 'continue' : 'end',
      isFinalAnswer: !result.success,
      iterations: state.iterations + 1,
      modelResponse: new AIMessage(content),
      observation: toolOutput,
      action: { name: toolName, arguments: toolArgs },
      userConfirmed: true,
      toolFeedback: state.toolFeedback,
      safetyConfig: {
        ...state.safetyConfig,
        requireToolConfirmation: state.safetyConfig.requireToolConfirmation ?? true,
        requireToolFeedback: state.safetyConfig.requireToolFeedback ?? false,
        maxInputLength: state.safetyConfig.maxInputLength ?? 10000,
        dangerousToolPatterns: state.safetyConfig.dangerousToolPatterns ?? []
      }
    }

    if (state.safetyConfig?.requireToolFeedback) {
      const feedbackState = await UserInteractionManager.handleToolFeedback(
        updatedState,
        toolName,
        result,
        safetyResult
      )
      return {
        ...updatedState,
        messages: feedbackState.messages,
        toolFeedback: feedbackState.toolFeedback || state.toolFeedback
      }
    }

    return updatedState
  } catch (error) {
    logger.error({ error }, 'Agent execution error')
    return createErrorState(state, error instanceof Error ? error.message : 'Unknown error')
  }
})

export function createReActAgent(config: FunctionalReActConfig) {
  const wrappedTools = config.tools.map(convertToBaseReActTool)
  logger.debug({ toolCount: wrappedTools.length }, 'Creating ReAct Agent')

  return entrypoint(
    {
      checkpointer: config.memoryPersistence || new MemorySaver(),
      name: 'react_agent'
    },
    async (input: AgentInput, runConfig?: RunnableConfig): Promise<AgentOutput> => {
      const initialState: AgentState = {
        messages: input.messages || [],
        iterations: 0,
        status: 'continue' as const,
        isFinalAnswer: false,
        safetyConfig: config.safetyConfig,
        tools: wrappedTools,
        chatModel: config.chatModel || new ChatOllama({
          model: config.modelName,
          baseUrl: config.host
        }),
        maxIterations: config.maxIterations,
        threadId: config.threadId,
        configurable: {
          ...input.configurable,
          ...runConfig?.configurable,
          thread_id: config.threadId,
          checkpoint_ns: 'react_agent'
        },
        modelResponse: new AIMessage({ content: '' }),
        action: null,
        observation: null,
        toolFeedback: {},
        userConfirmed: false
      }

      let state = initialState
      while (state.status === 'continue' && state.iterations < config.maxIterations) {
        state = await executeAgentStep(state)
      }

      return {
        messages: state.messages,
        status: state.status,
        toolFeedback: state.toolFeedback,
        iterations: state.iterations,
        threadId: state.threadId,
        configurable: {
          thread_id: state.threadId,
          checkpoint_ns: 'react_agent',
          ...state.configurable
        }
      }
    }
  )
}


