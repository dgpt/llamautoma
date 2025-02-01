import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { AgentState, SafetyCheckResult, ToolExecutionResult } from '../types'
import { logger } from '../../../utils/logger'
import { BaseMessage } from '@langchain/core/messages'

// Wait for user input with timeout
const waitForUserInput = async (
  state: AgentState,
): Promise<{ messages: BaseMessage[]; userInput?: string }> => {
  try {
    const controller = new AbortController()
    const signal = controller.signal

    const userInput = await new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('User input aborted'))
        return
      }

      const onData = (data: Buffer) => {
        const input = data.toString().trim()
        resolve(input)
        process.stdin.removeListener('data', onData)
      }

      process.stdin.on('data', onData)

      signal.addEventListener('abort', () => {
        process.stdin.removeListener('data', onData)
        reject(new Error('User input aborted'))
      }, { once: true })
    })

    return {
      messages: [...state.messages, new HumanMessage(userInput)],
      userInput
    }
  } catch (error) {
    logger.error({ error }, 'Error waiting for user input')
    return {
      messages: [...state.messages, new AIMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)],
      userInput: 'ERROR'
    }
  }
}

export const UserInteractionManager = {
  waitForUserInput,
  async requestToolConfirmation(state: AgentState, toolName: string, toolArgs: string): Promise<AgentState> {
    try {
      const messages = [...state.messages]
      messages.push(
        new AIMessage(
          `Tool execution requires confirmation:\nTool: ${toolName}\nArguments: ${toolArgs}\nPlease confirm (yes/no):`
        )
      )

      const confirmationState = await waitForUserInput({ ...state, messages })
      const userConfirmed = confirmationState.userInput?.toLowerCase() === 'yes'

      return {
        ...state,
        messages: confirmationState.messages,
        userConfirmed,
        safetyConfig: state.safetyConfig,
        tools: state.tools,
        chatModel: state.chatModel,
        maxIterations: state.maxIterations,
        threadId: state.threadId,
        configurable: state.configurable,
        modelResponse: state.modelResponse,
        action: state.action,
        observation: state.observation,
        toolFeedback: state.toolFeedback,
        iterations: state.iterations,
        status: state.status,
        isFinalAnswer: state.isFinalAnswer
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error requesting tool confirmation')
      return {
        ...state,
        messages: [
          ...state.messages,
          new AIMessage(`Error requesting confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`)
        ],
        userConfirmed: false,
        safetyConfig: state.safetyConfig,
        tools: state.tools,
        chatModel: state.chatModel,
        maxIterations: state.maxIterations,
        threadId: state.threadId,
        configurable: state.configurable,
        modelResponse: state.modelResponse,
        action: state.action,
        observation: state.observation,
        toolFeedback: state.toolFeedback,
        iterations: state.iterations,
        status: state.status,
        isFinalAnswer: state.isFinalAnswer
      }
    }
  },

  async handleToolFeedback(
    state: AgentState,
    toolName: string,
    result: ToolExecutionResult,
    safetyResult?: SafetyCheckResult
  ): Promise<{ messages: BaseMessage[]; toolFeedback?: Record<string, string> }> {
    try {
      // Add result message
      const resultMessage = new AIMessage(
        `Tool execution ${result.success ? 'succeeded' : 'failed'}:\n${result.output}`
      )
      const messagesWithResult = [...state.messages, resultMessage]

      // If feedback not required, return early
      if (!state.safetyConfig.requireToolFeedback) {
        logger.debug('Tool feedback not required', { toolName })
        return {
          messages: [...messagesWithResult, new AIMessage('Tool feedback not required')],
          toolFeedback: {
            ...state.toolFeedback,
            [toolName]: 'auto-approved'
          }
        }
      }

      // Add feedback request message
      const feedbackMessage = new AIMessage(
        `${
          safetyResult ? `Safety review: ${safetyResult.reason || (safetyResult.passed ? 'Passed' : 'Failed')}\n` : ''
        }Please provide feedback:`
      )
      const stateWithRequest = {
        ...state,
        messages: [...messagesWithResult, feedbackMessage]
      }

      // Wait for feedback
      logger.info({ toolName, result, safetyResult }, 'Requesting tool execution feedback')
      const feedbackResult = await waitForUserInput(stateWithRequest)

      return {
        messages: feedbackResult.messages,
        toolFeedback:
          feedbackResult.userInput === 'ERROR'
            ? undefined
            : {
                ...state.toolFeedback,
                [toolName]: feedbackResult.userInput || 'No feedback'
              }
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error handling tool feedback')
      return {
        messages: [
          ...(state?.messages || []),
          new AIMessage(`Error handling feedback: ${error instanceof Error ? error.message : 'Unknown error'}`)
        ],
        toolFeedback: undefined
      }
    }
  }
}
