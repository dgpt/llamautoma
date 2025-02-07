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
      `Review the following ${type} to ensure it meets the requirements:

      CONVERSATION CONTEXT:
      ${context}

      ${type.toUpperCase()} TO REVIEW:
      ${contentToReview}

      Respond with:
      1. Whether the ${type} is approved (yes/no)
      2. Detailed feedback if not approved
      3. Specific suggestions for improvement

      Keep the review thorough but concise.`
    )

    // Parse response
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const [decision, feedback, ...suggestionLines] = content.split('\n\n')

    // Parse decision
    const approved = decision.toLowerCase().includes('yes')

    // Parse suggestions
    const suggestions = suggestionLines
      .join('\n\n')
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [step, action] = line.split(':').map(s => s.trim())
        return { step, action }
      })

    // Create structured response
    const result = ReviewerTaskSchema.parse({
      approved,
      feedback: feedback || undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      response: {
        content: approved ? 'Review passed ✓' : feedback,
        type: approved ? 'success' : 'warning',
        shouldDisplay: true,
      },
    })

    // Update progress with completion
    sendTaskComplete('reviewer', approved ? 'Review approved' : 'Review rejected')

    return result
  }
)
