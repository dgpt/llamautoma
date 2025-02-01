import { entrypoint, task } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { ChatOllama } from '@langchain/ollama'
import { SystemMessage, AIMessage } from '@langchain/core/messages'
import { Tool } from '@langchain/core/tools'
import { RunnableConfig } from '@langchain/core/runnables'
import { logger } from '../../utils/logger'
import { AgentState, AgentInput, AgentOutput, FunctionalReActConfig } from '../../types/agent'
import { SafetyChecker } from './safety/safetyChecker'
import { ToolExecutor } from './tools/toolExecutor'
import { UserInteractionManager } from './interaction/userInteractionManager'
import { convertToBaseReActTool } from './tools/baseTool'

const SYSTEM_PROMPT = `You are an advanced AI assistant designed to solve tasks systematically and safely.
Your responses MUST ALWAYS be in XML format.

Guidelines:
1. Break down complex tasks into manageable steps
2. Use available tools strategically and safely
3. Provide clear, step-by-step reasoning
4. For each action, respond with:

For thinking/reasoning:
<response type="thought">
  <content>Your reasoning here</content>
</response>

For tool calls:
<response type="tool">
  <thought>Your reasoning</thought>
  <action>Tool name</action>
  <args>
    {
      "key": "value"
    }
  </args>
</response>

For tool results:
<response type="observation">
  <content>Tool output here</content>
</response>

For chat responses:
<response type="chat">
  <content>Your message here</content>
</response>

For file edits:
<response type="edit">
  <file>path/to/file</file>
  <changes>
    <change type="[insert|update|delete]">
      <location>[line number or range]</location>
      <content>The new content</content>
    </change>
  </changes>
</response>

For file creation:
<response type="compose">
  <file>
    <path>file/path/here</path>
    <content>
      File content here
    </content>
  </file>
</response>

For file synchronization:
<response type="sync">
  <file>
    <path>file/path/here</path>
    <content>
      File content here
    </content>
  </file>
</response>

For final answers:
<response type="final">
  <content>Your final answer here</content>
</response>

IMPORTANT:
- ALWAYS wrap responses in appropriate XML tags
- ALWAYS use valid JSON for tool arguments
- Wait for user confirmation when required
- Provide feedback after tool execution
- Stop if safety checks fail

Available tools:
{tools}`

const parseModelResponse = task(
  'parse_model_response',
  async (content: string) => {
    try {
      // First validate basic XML structure
      if (!content.match(/<response type="[^"]+">.*?<\/response>/s)) {
        return { success: false, error: 'Invalid XML format' as const }
      }

      // Extract response type
      const typeMatch = content.match(/<response type="([^"]+)">/s)
      if (!typeMatch) {
        return { success: false, error: 'Missing response type' as const }
      }

      const responseType = typeMatch[1]

      switch (responseType) {
        case 'tool': {
          const toolMatch = content.match(/<response type="tool">\s*<thought>(.*?)<\/thought>\s*<action>(.*?)<\/action>\s*<args>(.*?)<\/args>\s*<\/response>/s)
          if (!toolMatch) {
            return { success: false, error: 'Invalid tool response format' as const }
          }
          const [_, thought, toolName, argsStr] = toolMatch
          try {
            const args = JSON.parse(argsStr.trim())
            return { success: true, responseType, toolName, toolArgs: args, thought }
          } catch (error) {
            logger.error({ error }, 'Failed to parse tool arguments JSON')
            return { success: false, error: 'Invalid JSON in tool arguments' as const }
          }
        }

        case 'final':
        case 'chat':
        case 'thought':
        case 'observation':
        case 'feedback':
        case 'error': {
          const contentMatch = content.match(new RegExp(`<response type="${responseType}">\\s*<content>(.*?)<\\/content>\\s*<\\/response>`, 's'))
          if (!contentMatch) {
            return { success: false, error: `Invalid ${responseType} response format` as const }
          }
          return {
            success: true,
            responseType,
            content: contentMatch[1].trim(),
            isFinal: responseType === 'final' || responseType === 'chat'
          }
        }

        case 'edit': {
          const fileMatch = content.match(/<file>(.*?)<\/file>/s)
          const changes = Array.from(content.matchAll(/<change type="([^"]+)">\s*<location>(.*?)<\/location>\s*<content>(.*?)<\/content>\s*<\/change>/gs))
          if (!fileMatch || !changes.length) {
            return { success: false, error: 'Invalid edit response format' as const }
          }
          return {
            success: true,
            responseType,
            file: fileMatch[1].trim(),
            changes: changes.map(([_, type, location, content]) => ({ type, location, content }))
          }
        }

        case 'compose':
        case 'sync': {
          const fileMatch = content.match(/<file>\s*<path>(.*?)<\/path>\s*<content>(.*?)<\/content>\s*<\/file>/s)
          if (!fileMatch) {
            return { success: false, error: `Invalid ${responseType} response format` as const }
          }
          return {
            success: true,
            responseType,
            path: fileMatch[1].trim(),
            content: fileMatch[2].trim()
          }
        }

        default:
          return { success: false, error: `Unknown response type: ${responseType}` as const }
      }
    } catch (error) {
      logger.error({ error }, 'Error parsing model response')
      return { success: false, error: 'Failed to parse model response' as const }
    }
  }
)

const createErrorState = (state: AgentState, errorMessage: string): AgentState => ({
  ...state,
  messages: [...state.messages, new AIMessage(`<response type="error"><content>${errorMessage}</content></response>`)],
  status: 'end',
  isFinalAnswer: true,
  modelResponse: new AIMessage(`<response type="error"><content>${errorMessage}</content></response>`),
  toolFeedback: state.toolFeedback,
  action: null,
  observation: null,
  userConfirmed: false
})

const executeAgentStep = task(
  'execute_agent_step',
  async (state: AgentState, runConfig?: RunnableConfig): Promise<AgentState> => {
    try {
      const toolDescriptions = state.tools.map((tool: Tool) => `${tool.name}: ${tool.description}`).join('\n')
      const messages = [new SystemMessage(SYSTEM_PROMPT.replace('{tools}', toolDescriptions)), ...state.messages]

      logger.debug({ messageCount: messages.length, threadId: state.threadId }, 'Executing model step')
      logger.debug({ chatModel: state.chatModel }, 'Chat model')

      const modelResponse = await state.chatModel.invoke(messages, runConfig)
      const content = modelResponse.content.toString()
      logger.debug({ content, threadId: state.threadId }, 'Raw model response')

      // Ensure content is XML formatted
      const formattedContent = content.startsWith('<response') ?
        content :
        `<response type="chat"><content>${content}</content></response>`
      logger.debug({ formattedContent, threadId: state.threadId }, 'Formatted content')

      // Validate XML format
      if (!formattedContent.match(/<response type="[^"]+">.*?<\/response>/s)) {
        logger.error({ formattedContent, threadId: state.threadId }, 'Invalid XML format')
        return createErrorState(state, 'Response is not in valid XML format')
      }

      const parseResult = await parseModelResponse(formattedContent)
      if (!parseResult.success) {
        logger.error({ error: parseResult.error, threadId: state.threadId }, 'Failed to parse model response')
        return createErrorState(state, parseResult.error || 'Failed to parse model response')
      }
      logger.debug({ parseResult, threadId: state.threadId }, 'Parsed model response')

      // Create AIMessage with the formatted content
      const messageToAdd = new AIMessage(formattedContent)

      // Handle different response types
      switch (parseResult.responseType) {
        case 'final':
        case 'chat': {
          logger.debug({ responseType: parseResult.responseType, threadId: state.threadId }, 'Handling chat/final response')
          // Ensure we mark the stream as complete
          return {
            ...state,
            messages: [...state.messages, messageToAdd],
            status: 'end',
            isFinalAnswer: true,
            modelResponse: messageToAdd,
            toolFeedback: state.toolFeedback,
            streamComplete: true // Add this flag to indicate stream completion
          }
        }

        case 'tool': {
          logger.debug({ responseType: 'tool', threadId: state.threadId }, 'Handling tool response')
          const { toolName, toolArgs, thought } = parseResult
          const tool = state.tools.find((t) => t.name === toolName)
          if (!tool) {
            logger.error({ toolName, threadId: state.threadId }, 'Tool not found')
            return createErrorState(state, `Tool '${toolName}' not found`)
          }

          const safetyResult = await SafetyChecker.runSafetyChecks(toolName, toolArgs, state.safetyConfig)
          if (!safetyResult.passed) {
            logger.error({ toolName, reason: safetyResult.reason, threadId: state.threadId }, 'Safety check failed')
            return createErrorState(state, `Tool execution blocked: ${safetyResult.reason || 'Safety check failed'}`)
          }

          if (state.safetyConfig?.requireToolConfirmation) {
            logger.debug({ toolName, threadId: state.threadId }, 'Requesting tool confirmation')
            const confirmationState = await UserInteractionManager.requestToolConfirmation(state, toolName, toolArgs)
            if (!confirmationState.userConfirmed) {
              logger.error({ toolName, threadId: state.threadId }, 'Tool execution rejected by user')
              return createErrorState(state, 'Tool execution rejected by user')
            }
          }

          logger.debug({ toolName, threadId: state.threadId }, 'Executing tool')
          const { result, newState } = await ToolExecutor.executeTool(state, tool, toolArgs)
          const toolOutput = `<response type="observation"><content>${result.output || 'No output from tool'}</content></response>`
          logger.debug({ toolOutput, threadId: state.threadId }, 'Tool execution complete')

          const updatedState: AgentState = {
            ...state,
            ...newState,
            messages: [...state.messages, messageToAdd, new AIMessage(toolOutput)],
            status: result.success ? 'continue' : 'end',
            isFinalAnswer: !result.success,
            iterations: state.iterations + 1,
            modelResponse: messageToAdd,
            observation: toolOutput,
            action: { name: toolName, arguments: toolArgs },
            userConfirmed: true,
            toolFeedback: state.toolFeedback,
            streamComplete: !result.success, // Mark stream as complete if tool execution failed
            configurable: {
              ...state.configurable,
              thread_id: state.threadId,
              checkpoint_ns: 'react_agent',
              [Symbol.toStringTag]: 'AgentConfigurable' as const
            }
          }

          if (state.safetyConfig?.requireToolFeedback) {
            logger.debug({ toolName, threadId: state.threadId }, 'Handling tool feedback')
            const feedbackState = await UserInteractionManager.handleToolFeedback(
              updatedState,
              toolName,
              result,
              safetyResult
            )
            return {
              ...updatedState,
              messages: feedbackState.messages.map(msg => {
                // Ensure feedback messages are in XML format
                if (msg.content.toString().startsWith('<response')) {
                  return msg
                }
                return new AIMessage(`<response type="feedback"><content>${msg.content}</content></response>`)
              }),
              toolFeedback: feedbackState.toolFeedback || state.toolFeedback
            }
          }

          return updatedState
        }

        case 'thought':
        case 'observation':
        case 'feedback': {
          logger.debug({ responseType: parseResult.responseType, threadId: state.threadId }, 'Handling thought/observation/feedback response')
          return {
            ...state,
            messages: [...state.messages, messageToAdd],
            status: 'continue',
            isFinalAnswer: false,
            modelResponse: messageToAdd,
            toolFeedback: state.toolFeedback,
            streamComplete: false
          }
        }

        case 'edit':
        case 'compose':
        case 'sync': {
          logger.debug({ responseType: parseResult.responseType, threadId: state.threadId }, 'Handling edit/compose/sync response')
          return {
            ...state,
            messages: [...state.messages, messageToAdd],
            status: 'end',
            isFinalAnswer: true,
            modelResponse: messageToAdd,
            toolFeedback: state.toolFeedback,
            streamComplete: true // Mark stream as complete for these operations
          }
        }

        default:
          logger.error({ responseType: parseResult.responseType, threadId: state.threadId }, 'Unknown response type')
          return createErrorState(state, `Unknown response type: ${parseResult.responseType}`)
      }
    } catch (error) {
      logger.error({ error, threadId: state.threadId }, 'Agent execution error')
      return createErrorState(state, error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

export function createReActAgent(config: FunctionalReActConfig) {
  const wrappedTools = config.tools.map(convertToBaseReActTool)
  logger.debug({ toolCount: wrappedTools.length }, 'Creating ReAct Agent')

  return entrypoint(
    {
      checkpointer: config.memoryPersistence || new MemorySaver(),
      name: 'react_agent'
    },
    async (input: AgentInput, runConfig?: RunnableConfig): Promise<AgentOutput> => {
      if (!config.threadId) {
        throw new Error('threadId is required')
      }

      // Create a base configurable that will be used throughout the agent's lifecycle
      const baseConfigurable = {
        thread_id: config.threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable' as const
      }

      // Merge configurable objects, ensuring thread_id is preserved
      const configurable = {
        ...baseConfigurable,
        ...input.configurable,
        ...runConfig?.configurable,
        thread_id: config.threadId // Ensure thread_id is not overridden
      }

      // Create a new runConfig that will be used for all operations
      const newRunConfig: RunnableConfig = {
        ...runConfig,
        configurable
      }

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
        configurable,
        modelResponse: new AIMessage({ content: '' }),
        action: null,
        observation: null,
        toolFeedback: {},
        userConfirmed: false
      }

      let state = initialState
      while (state.status === 'continue' && state.iterations < config.maxIterations) {
        // Pass the runConfig to executeAgentStep
        state = await executeAgentStep(state, newRunConfig)
      }

      return {
        messages: state.messages,
        status: state.status,
        toolFeedback: state.toolFeedback,
        iterations: state.iterations,
        threadId: state.threadId,
        configurable: {
          ...baseConfigurable,
          ...state.configurable,
          thread_id: state.threadId // Ensure thread_id is not overridden
        }
      }
    }
  )
}


