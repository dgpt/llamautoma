import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { AgentState, SafetyCheckResult, ToolExecutionResult } from '@/types/agent'
import { logger } from '@/logger'
import { formatXMLResponse } from '@/xml'

// Wait for user input with timeout
const waitForUserInput = async (
  state: AgentState
): Promise<{ messages: BaseMessage[]; userInput?: string }> => {
  // In test environment, bypass user input
  if (process.env.NODE_ENV === 'test') {
    return {
      messages: [...state.messages],
      userInput: 'yes', // Default to 'yes' in test environment
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
      userInput,
    }
  } catch (error) {
    logger.error({ error }, 'Error waiting for user input')
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      messages: [
        ...state.messages,
        new AIMessage(
          `<response type="error"><content>Error: ${errorMessage}</content></response>`
        ),
      ],
      userInput: undefined,
    }
  } finally {
    if (!signal.aborted) {
      controller.abort()
    }
  }
}

export const UserInteractionManager = {
  waitForUserInput,
  async requestToolConfirmation(
    state: AgentState,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<{ messages: BaseMessage[]; userConfirmed: boolean }> {
    try {
      // In test environment, auto-confirm
      if (process.env.NODE_ENV === 'test') {
        const confirmationMessage = new AIMessage(
          formatXMLResponse('confirmation', `Tool execution confirmed: ${toolName}`)
        )
        return {
          messages: [...state.messages, confirmationMessage],
          userConfirmed: true,
        }
      }

      const confirmationRequest = new AIMessage(
        formatXMLResponse(
          'confirmation',
          `Do you want to execute tool ${toolName} with args ${JSON.stringify(toolArgs)}?`
        )
      )

      const stateWithRequest = {
        ...state,
        messages: [...state.messages, confirmationRequest],
      }

      // Wait for confirmation
      logger.info({ toolName, toolArgs }, 'Requesting tool execution confirmation')
      const confirmationResult = await waitForUserInput(stateWithRequest)

      const confirmed = confirmationResult.userInput?.toLowerCase() === 'yes'
      const confirmationMessage = new AIMessage(
        formatXMLResponse(
          'confirmation',
          confirmed ? 'Tool execution confirmed' : 'Tool execution rejected'
        )
      )

      return {
        messages: [...confirmationResult.messages, confirmationMessage],
        userConfirmed: confirmed,
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error requesting tool confirmation')
      return {
        messages: [
          ...state.messages,
          new AIMessage(
            formatXMLResponse(
              'error',
              `Error requesting confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          ),
        ],
        userConfirmed: false,
      }
    }
  },

  async handleToolFeedback(
    state: AgentState,
    toolName: string,
    result: ToolExecutionResult,
    safetyResult?: SafetyCheckResult
  ): Promise<{ messages: BaseMessage[]; toolFeedback?: Record<string, unknown> }> {
    try {
      // In test environment, provide test feedback
      if (process.env.NODE_ENV === 'test') {
        const feedbackMessage = new AIMessage(
          formatXMLResponse('feedback', `Test feedback for tool: ${toolName}`)
        )
        return {
          messages: [...state.messages, feedbackMessage],
          toolFeedback: {
            ...state.toolFeedback,
            [toolName]: 'Test feedback',
          },
        }
      }

      const messagesWithResult = [...state.messages]
      if (result.success) {
        messagesWithResult.push(
          new AIMessage(
            formatXMLResponse(
              'chat',
              `Tool execution successful:\nTool: ${toolName}\nResult: ${result.output}`
            )
          )
        )
      } else {
        messagesWithResult.push(
          new AIMessage(
            formatXMLResponse(
              'error',
              `Tool execution failed:\nTool: ${toolName}\nError: ${result.error}`
            )
          )
        )
      }

      if (safetyResult?.warnings?.length) {
        messagesWithResult.push(
          new AIMessage(
            formatXMLResponse('warning', `Safety warnings:\n${safetyResult.warnings.join('\n')}`)
          )
        )
      }

      const feedbackMessage = new AIMessage(
        formatXMLResponse(
          'feedback',
          'Please provide feedback for tool execution (or type "ERROR" to report an issue):'
        )
      )

      const stateWithRequest = {
        ...state,
        messages: [...messagesWithResult, feedbackMessage],
      }

      // Wait for feedback
      logger.info({ toolName, result, safetyResult }, 'Requesting tool execution feedback')
      const feedbackResult = await waitForUserInput(stateWithRequest)

      const finalFeedbackMessage = new AIMessage(
        formatXMLResponse('feedback', feedbackResult.userInput || 'No feedback provided')
      )

      return {
        messages: [...feedbackResult.messages, finalFeedbackMessage],
        toolFeedback:
          feedbackResult.userInput === 'ERROR'
            ? undefined
            : {
                ...state.toolFeedback,
                [toolName]: feedbackResult.userInput || 'No feedback',
              },
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error handling tool feedback')
      return {
        messages: [
          ...state.messages,
          new AIMessage(
            formatXMLResponse(
              'error',
              `Error handling feedback: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          ),
        ],
        toolFeedback: state.toolFeedback,
      }
    }
  },
}
