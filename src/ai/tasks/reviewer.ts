import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { ReviewSchema } from 'llamautoma-types'
import type { Plan, GeneratedCode, Review } from 'llamautoma-types'
import { getMessageString } from './lib'
import { logger } from '@/logger'

// Create reviewer with structured output
const reviewer = createStructuredLLM<Review>(ReviewSchema)

// Common prompt parts
const REVIEW_FORMAT = `Response Format:
- "approved": boolean - REQUIRED - Whether the review passed
- "feedback": string - Required if approved is false, explaining why
- "suggestions": array - Required if approved is false, detailing specific improvements to make

You MUST ALWAYS provide an "approved" value of true or false.

Example of a REJECTION:
{
  "approved": false,
  "feedback": "Missing required functionality",
  "suggestions": [
    {
      "step": "Create a new React project",
      "action": "<action to improve the step>"
    },
    {
      "step": "Create a counter component",
      "action": "<suggested new step>"
    },
    {
      "step": "Add increment/decrement buttons",
      "action": "<suggested new step>"
    }
  ]
}

Example of an APPROVAL:
{
  "approved": true,
}
`

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
      logger.debug(`Reviewer invoked with plan: ${JSON.stringify(plan)}`)
      reviewPrompt = `You are a strict plan reviewer. Your ONLY job is to REJECT incomplete or insufficient plans.

AUTOMATIC REJECTION if ANY of these are true:
- Steps are vague
- Steps skip implementation details
- Steps are in wrong order
- Steps have safety concerns
- Steps assume knowledge
- Steps lack error handling
- Steps lack testing

A complete plan MUST have ALL of:
- Specific, actionable steps
- Complete implementation details
- All required tools specified
- Correct step ordering
- No assumed knowledge
- Error handling included
- Zero ambiguity

Conversation Context:
${context}

Plan to Review:
${JSON.stringify(plan, null, 2)}

${REVIEW_FORMAT}
`
    } else if (code) {
      logger.debug(`Reviewer invoked with code: ${JSON.stringify(code)}`)
      reviewPrompt = `You are a strict code reviewer. Review this code to ensure it EXACTLY fulfills the user's requirements.
If ANY requirements are missing or if the code doesn't FULLY address the user's request, you MUST reject it.

Conversation Context:
${context}

Code to Review:
${(code.files || []).map(file => `File: ${file.path}\n${file.content}`).join('\n\n')}

Requirements:
1. Verify code implements all requested functionality
2. Ensure code follows best practices and conventions
3. Check for proper error handling and edge cases
4. Validate type safety and TypeScript usage
5. Review dependencies and imports

Review Guidelines:
- REJECT if any requirements are missing
- REJECT if code doesn't follow best practices
- REJECT if error handling is inadequate
- REJECT if type safety is compromised
- REJECT if there are security concerns
- Provide specific, actionable feedback if rejected

${REVIEW_FORMAT}
`
    } else {
      throw new Error('Must provide either plan or code to review')
    }

    // Generate review using structured LLM
    const result = await reviewer.invoke([new HumanMessage(reviewPrompt)])
    logger.debug(`Reviewer response: ${JSON.stringify(result)}`)
    return {
      approved: result.approved,
      feedback: result.feedback,
      suggestions: result.suggestions || [],
    }
  }
)
