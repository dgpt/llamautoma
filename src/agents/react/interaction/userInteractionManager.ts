import { task } from '@langchain/langgraph'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { AgentState, SafetyCheckResult, ToolExecutionResult } from '../types'
import { logger } from '../../../utils/logger'
import { MessageContent } from '@langchain/core/messages'
import { BaseMessage } from '@langchain/core/messages'

interface InteractionResult {
  userInput: string
  messages: BaseMessage[]
}

// Constants
const DEFAULT_TIMEOUT = 30000
const AUTO_APPROVE_TIMEOUT = 100

// Wait for user input with timeout
const waitForUserInput = task('wait_for_user_input', async (state: AgentState, timeout?: number) => {
  try {
    const effectiveTimeout = process.env.NODE_ENV === 'test' ? AUTO_APPROVE_TIMEOUT : timeout ?? DEFAULT_TIMEOUT

    // In test mode, auto-approve after timeout
    if (process.env.NODE_ENV === 'test') {
      await new Promise((resolve) => setTimeout(resolve, effectiveTimeout))
      return {
        userInput: 'auto-approved',
        messages: state.messages,
      }
    }

    // TODO: Implement actual user input handling
    // This is a placeholder that auto-approves after timeout
    await new Promise((resolve) => setTimeout(resolve, effectiveTimeout))
    return {
      userInput: 'auto-approved',
      messages: state.messages,
    }
  } catch (error) {
    logger.error({ error }, 'Error waiting for user input')
    return {
      userInput: 'ERROR',
      messages: [...state.messages, new AIMessage('Error waiting for user input')],
    }
  }
})

// Request tool execution confirmation
const requestToolConfirmation = task(
  'request_tool_confirmation',
  async (state: AgentState, toolName: string, input: string) => {
    try {
      // Add confirmation request message
      const confirmationMessage = new AIMessage(
        `Tool execution request:\nTool: ${toolName}\nInput: ${input}\nPlease confirm (yes/no):`
      )
      const stateWithRequest = {
        ...state,
        messages: [...state.messages, confirmationMessage],
      }

      // Wait for confirmation
      logger.info({ toolName, input }, 'Requesting tool execution confirmation')
      const confirmationResult = await waitForUserInput(stateWithRequest, DEFAULT_TIMEOUT)

      return {
        ...state,
        userConfirmed: confirmationResult.userInput === 'auto-approved',
        messages: confirmationResult.messages,
        toolCallReviews: {
          ...state.toolCallReviews,
          [toolName]: confirmationResult.userInput,
        },
      }
    } catch (error) {
      logger.error({ error, toolName }, 'Error handling tool confirmation')
      return {
        ...state,
        userConfirmed: false,
        messages: [...state.messages, new AIMessage('Error handling tool confirmation')],
      }
    }
  }
)

// Handle tool execution feedback
const handleToolFeedback = task(
  'handle_tool_feedback',
  async (state: AgentState, toolName: string, result: ToolExecutionResult, safetyResult?: SafetyCheckResult) => {
    try {
      // Add result message
      const resultMessage = new AIMessage(
        `Tool execution ${result.success ? 'succeeded' : 'failed'}:\n${result.output}`
      )
      const messagesWithResult = [...state.messages, resultMessage]

      // If feedback not required, return early
      if (!state.safetyConfig?.requireToolFeedback) {
        logger.debug('Tool feedback not required', { toolName })
        return {
          messages: [...messagesWithResult, new AIMessage('Tool feedback not required')],
          toolFeedback: {
            ...state.toolFeedback,
            [toolName]: 'auto-approved',
          },
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
        messages: [...messagesWithResult, feedbackMessage],
      }

      // Wait for feedback
      logger.info({ toolName, result, safetyResult }, 'Requesting tool execution feedback')
      const feedbackResult = await waitForUserInput(stateWithRequest, DEFAULT_TIMEOUT)

      return {
        messages: feedbackResult.messages,
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
          ...(state?.messages || []),
          new AIMessage(`Error handling feedback: ${error instanceof Error ? error.message : 'Unknown error'}`),
        ],
        toolFeedback: undefined,
      }
    }
  }
)

export const UserInteractionManager = {
  waitForUserInput,
  requestToolConfirmation,
  handleToolFeedback,
}
