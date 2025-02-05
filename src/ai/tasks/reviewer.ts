import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { createStructuredLLM } from '../llm'
import { ReviewSchema } from 'llamautoma-types'
import type { Plan, GeneratedCode, Review } from 'llamautoma-types'
import { getMessageString } from './lib'
import { logger } from '@/logger'

// Create reviewer with structured output
const reviewer = createStructuredLLM<Review>(ReviewSchema)

// Create the reviewer task
export const reviewerTask = task(
  'reviewer',
  async ({
    messages,
    plan,
    code,
    config,
  }: {
    messages: BaseMessage[]
    plan?: Plan
    code?: GeneratedCode
    config: RunnableConfig
  }): Promise<Review> => {
    // Combine messages into context
    const context = messages.map(msg => getMessageString(msg)).join('\n')

    // Generate review prompt based on what's being reviewed
    let reviewPrompt = ''
    if (plan) {
      logger.debug(`Reviewer invoked with plan: ${JSON.stringify(plan)}`)
      reviewPrompt = `You are a code reviewer reviewing a high-level plan. Your job is to ensure the plan has the basic steps needed to achieve the goal.
Be very lenient - if the plan has the minimum steps needed, approve it. Implementation details can be figured out later.

For example, for a React counter component, these steps would be sufficient to approve:
- Initialize React project
- Create counter component

Conversation Context:
${context}

Plan to Review:
${JSON.stringify(plan, null, 2)}

Requirements:
1. APPROVE if the plan has the minimum steps needed (be very lenient!)
2. APPROVE if steps are in a logical order
3. REJECT ONLY if CRITICAL steps are COMPLETELY MISSING
4. When rejecting, you MUST use the word "missing" in your feedback
5. Approve if in doubt - implementation details come later

IMPORTANT:
- When rejecting, your feedback MUST contain the word "missing"
- For simple components, 1-2 high-level steps is often enough
- Err on the side of approving if the basic steps are there

You must respond with a JSON object in this exact format:
{
  "approved": boolean,  // true if plan has basic steps, false if critical steps are missing
  "feedback": string,   // detailed explanation of why the plan was approved or rejected
  "suggestions": string[],  // optional array of suggested improvements
  "metadata": object    // optional metadata about the review
}

Review:`
    } else if (code) {
      logger.debug(`Reviewer invoked with code: ${JSON.stringify(code)}`)
      reviewPrompt = `You are a code reviewer reviewing a React component implementation. Review the following code to ensure it follows React best practices and patterns.

Critical React Requirements:
- MUST use hooks (e.g. useState) for state management
- MUST NOT use direct mutations of variables
- MUST use proper event handlers
- MUST follow React component patterns

Conversation Context:
${context}

Code to Review:
${JSON.stringify(code, null, 2)}

Requirements:
1. REJECT if code doesn't use proper React patterns (e.g. useState for state)
2. REJECT if code uses direct mutations instead of state updates
3. REJECT if code has critical issues or missing functionality
4. REJECT if code doesn't follow React best practices
5. Minor style/optimization issues can be suggested without rejecting

You must respond with a JSON object in this exact format:
{
  "approved": boolean,  // true if code follows React patterns, false if critical issues
  "feedback": string,   // detailed explanation of why the code was approved or rejected
  "suggestions": string[],  // optional array of suggested improvements
  "metadata": object    // optional metadata about the review
}

Review:`
    } else {
      throw new Error('Must provide either plan or code to review')
    }
    logger.debug(`Reviewer prompt: ${reviewPrompt}`)

    // Generate review using structured LLM
    const result = await reviewer.invoke([new HumanMessage(reviewPrompt)], config)
    logger.debug(`Reviewer response: ${JSON.stringify(result)}`)
    return {
      approved: result.approved,
      feedback: result.feedback,
      suggestions: result.suggestions,
      metadata: result.metadata,
    }
  }
)
