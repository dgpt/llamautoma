import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { ReviewSchema } from 'llamautoma-types'
import type { Plan, GeneratedCode, Review } from 'llamautoma-types'
import { getMessageString } from './lib'

// Create reviewer with structured output
const reviewer = createStructuredLLM<Review>(ReviewSchema)

// Create the reviewer task
export const reviewerTask = task(
  'reviewer',
  async ({
    messages,
    plan,
    code,
  }: {
    messages: BaseMessage[]
    plan?: Plan
    code?: GeneratedCode
  }): Promise<Review> => {
    // Combine messages into context
    const context = messages.map(msg => getMessageString(msg)).join('\n')

    // Generate review prompt based on what's being reviewed
    let reviewPrompt = ''
    if (plan) {
      reviewPrompt = `Review the following plan to ensure it fulfills the user's requirements:

Conversation Context:
${context}

Plan to Review:
${JSON.stringify(plan, null, 2)}

Requirements:
1. Verify all necessary steps are included
2. Check for proper step dependencies
3. Validate tool requirements
4. Assess safety concerns
5. Suggest improvements if needed

Review:`
    } else if (code) {
      reviewPrompt = `Review the following code to ensure it fulfills the user's requirements:

Conversation Context:
${context}

Code to Review:
${JSON.stringify(code, null, 2)}

Requirements:
1. Verify functionality matches requirements
2. Check for proper error handling
3. Validate code safety
4. Assess performance concerns
5. Suggest improvements if needed

Review:`
    } else {
      throw new Error('Must provide either plan or code to review')
    }

    // Generate review using structured LLM
    const result = await reviewer.invoke(reviewPrompt)
    return {
      approved: result.approved,
      feedback: result.feedback,
      suggestions: result.suggestions,
      metadata: result.metadata,
    }
  }
)
