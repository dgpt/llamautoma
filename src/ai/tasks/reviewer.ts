import { task } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { updateProgress, sendTaskResponse, sendTaskComplete } from '../utils/stream'
import { ReviewerTaskSchema } from './schemas/tasks'

/**
 * Reviews generated code or plans to ensure they meet requirements
 */
export const reviewerTask = task(
  'reviewer',
  async (
    input: {
      messages: BaseMessage[]
      plan?: string
      code?: { files: any[] }
    },
    config?: RunnableConfig
  ) => {
    const type = input.code ? 'code' : 'plan'
    const contentToReview = input.code
      ? JSON.stringify(input.code.files, null, 2)
      : input.plan
        ? input.plan
        : ''

    if (!contentToReview) {
      throw new Error('Either plan or code must be provided')
    }

    // Update initial progress
    updateProgress('reviewer', `Reviewing ${type}...`, config)

    // Convert messages to string for context
    const context = input.messages.map(getMessageString).join('\n')

    // Generate review using LLM
    const response = await llm.invoke(
      `Review the following ${type} based on the conversation context:

      Context:
      ${context}

      ${type.toUpperCase()} TO REVIEW:
      ${contentToReview}

      Respond with:
      1. Whether you approve or not (be strict!)
      2. Detailed feedback if not approved
      3. Specific suggestions for improvement if not approved
         Format suggestions as: "- step: action"

      Focus on:
      ${
        type === 'plan'
          ? `
      - Completeness (covers all requirements)
      - Clarity (steps are clear and actionable)
      - Dependencies (steps are in correct order)
      - Feasibility (steps can be implemented)
      `
          : `
      - Code quality and readability
      - Error handling and edge cases
      - Type safety and documentation
      - Testing and maintainability
      `
      }
      - User requirements (matches user's intent)

      Keep the response clear and actionable.`
    )

    // Parse review feedback
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const [decision, feedback, ...suggestionLines] = content.split('\n\n')
    const approved = decision.toLowerCase().includes('approve')
    const suggestions = suggestionLines
      .flatMap(line => line.split('\n'))
      .filter(line => line.startsWith('-'))
      .map(line => {
        const [step, action] = line.slice(2).split(': ')
        return { step, action }
      })

    // Send review decision to chat window
    const responseMessage = approved
      ? `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} approved!`
      : `❌ Changes needed for ${type}. See feedback for details.`
    sendTaskResponse('reviewer', responseMessage)

    // If not approved, send feedback
    if (!approved && feedback) {
      sendTaskResponse('reviewer', `\nFeedback:\n${feedback}`)
      if (suggestions.length > 0) {
        sendTaskResponse(
          'reviewer',
          `\nSuggestions:\n${suggestions.map(s => `- ${s.step}: ${s.action}`).join('\n')}`
        )
      }
    }

    // Create structured response
    const result = ReviewerTaskSchema.parse({
      approved,
      feedback: feedback || undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      response: responseMessage,
    })

    // Update progress with completion
    sendTaskComplete('reviewer', approved ? 'Review approved' : 'Review rejected')

    return result
  }
)
