import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { AgentState, SafetyCheckResult, ToolExecutionResult } from '../types'
import { logger } from '../../../utils/logger'
import { BaseMessage } from '@langchain/core/messages'

// Wait for user input with timeout
const waitForUserInput = async (
  state: AgentState,
): Promise<{ messages: BaseMessage[]; userInput?: string }> => {
  // In test environment, bypass user input
  if (process.env.NODE_ENV === 'test') {
    return {
      messages: [...state.messages],
      userInput: 'yes' // Default to 'yes' in test environment
    }
  }

  const controller = new AbortController()
  const signal = controller.signal

  try {
    const userInput = await new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('User input aborted'))
        return
      }

      const cleanup = () => {
        process.stdin.removeListener('data', onData)
        signal.removeEventListener('abort', onAbort)
      }

      const onData = (data: Buffer) => {
        const input = data.toString().trim()
        cleanup()
        resolve(input)
      }

      const onAbort = () => {
        cleanup()
        reject(new Error('User input aborted'))
      }

      process.stdin.on('data', onData)
      signal.addEventListener('abort', onAbort, { once: true })
    })

    return {
      messages: [...state.messages, new HumanMessage(userInput)],
      userInput
    }
  } catch (error) {
    logger.error({ error }, 'Error waiting for user input')
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      messages: [
        ...state.messages,
        new AIMessage(`<response type="error"><content>Error: ${errorMessage}</content></response>`)
      ],
      userInput: undefined
    }
  } finally {
    if (!signal.aborted) {
      controller.abort()
    }
  }
}

export const UserInteractionManager = {
  waitForUserInput,
  async requestToolConfirmation(state: AgentState, toolName: string, toolArgs: string): Promise<AgentState> {
    try {
      // In test environment, bypass confirmation
      if (process.env.NODE_ENV === 'test') {
        return {
          ...state,
          messages: [...state.messages],
          userConfirmed: true
        }
      }

      const messages = [...state.messages]
      messages.push(
        new AIMessage(
          `<response type="chat"><content>Tool execution requires confirmation:\nTool: ${toolName}\nArguments: ${toolArgs}\nPlease confirm (yes/no):</content></response>`
        )
      )

      const confirmationState = await waitForUserInput({ ...state, messages })
      const userConfirmed = confirmationState.userInput?.toLowerCase() === 'yes'

      return {
        ...state,
        messages: confirmationState.messages,
        userConfirmed
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error requesting tool confirmation')
      return {
        ...state,
        messages: [
          ...state.messages,
          new AIMessage(`<response type="error"><content>Error requesting confirmation: ${error instanceof Error ? error.message : 'Unknown error'}</content></response>`)
        ],
        userConfirmed: false
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
      // In test environment, bypass feedback
      if (process.env.NODE_ENV === 'test') {
        return {
          messages: state.messages,
          toolFeedback: {
            ...state.toolFeedback,
            [toolName]: 'Test feedback'
          }
        }
      }

      const messagesWithResult = [...state.messages]
      if (result.success) {
        messagesWithResult.push(
          new AIMessage(
            `<response type="chat"><content>Tool execution successful:\nTool: ${toolName}\nResult: ${result.output}</content></response>`
          )
        )
      } else {
        messagesWithResult.push(
          new AIMessage(
            `<response type="error"><content>Tool execution failed:\nTool: ${toolName}\nError: ${result.error}</content></response>`
          )
        )
      }

      if (safetyResult?.warnings?.length) {
        messagesWithResult.push(
          new AIMessage(
            `<response type="chat"><content>Safety warnings:\n${safetyResult.warnings.join('\n')}</content></response>`
          )
        )
      }

      const feedbackMessage = new AIMessage(
        `<response type="chat"><content>Please provide feedback for tool execution (or type 'ERROR' to report an issue):</content></response>`
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
          new AIMessage(`<response type="error"><content>Error handling feedback: ${error instanceof Error ? error.message : 'Unknown error'}</content></response>`)
        ],
        toolFeedback: undefined
      }
    }
  }
}
