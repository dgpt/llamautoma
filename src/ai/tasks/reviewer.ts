import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { getMessageString } from './utils'
import type { Plan } from './planner'
import type { GeneratedCode } from './coder'

// Schema for review output
export const reviewSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  suggestions: z.array(z.string()),
  safety_concerns: z.array(z.string()).optional(),
})

export type Review = z.infer<typeof reviewSchema>

// Create reviewer with structured output
const reviewer = createStructuredLLM(reviewSchema)

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
    return await reviewer.invoke(reviewPrompt)
  }
)
