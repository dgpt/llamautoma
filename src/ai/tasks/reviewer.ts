import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { createStructuredLLM } from '../llm'
import { ReviewSchema } from 'llamautoma-types'
import type { Plan, GeneratedCode, Review } from 'llamautoma-types'
import { getMessageString } from './lib'
import { logger } from '@/logger'
import { StructuredOutputParser } from '@langchain/core/output_parsers'

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
    const parser = StructuredOutputParser.fromZodSchema(ReviewSchema)
    const formatInstructions = parser.getFormatInstructions()

    // Generate review prompt based on what's being reviewed
    let reviewPrompt = ''
    if (plan) {
      logger.debug(`Reviewer invoked with plan: ${JSON.stringify(plan)}`)
      reviewPrompt = `You are a strict code reviewer. Review the following plan to ensure it EXACTLY fulfills the user's requirements.
If ANY required steps are missing or if the plan doesn't FULLY address the user's request, you MUST reject it.

Conversation Context:
${context}

Plan to Review:
${JSON.stringify(plan, null, 2)}

Requirements:
1. REJECT if ANY necessary steps are missing
2. REJECT if steps don't fully address the user's request
3. REJECT if steps are in wrong order
4. REJECT if there are safety concerns
5. Provide specific feedback about what's missing or wrong

${formatInstructions}
`
    } else if (code) {
      logger.debug(`Reviewer invoked with code: ${JSON.stringify(code)}`)
      reviewPrompt = `You are a strict code reviewer. Review the following code to ensure it EXACTLY fulfills the user's requirements.
If ANY requirements are missing or if the code doesn't FULLY address the user's request, you MUST reject it.
You MUST include feedback and a list of suggestions for improvement if you reject the code.
You MUST ensure { "approved": true } is returned if the code is accepted.

Conversation Context:
${context}

Code to Review:
${code.files.map(file => `File: ${file.path}\n${file.content}`).join('\n\n')}

${formatInstructions}
`
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
      suggestions: result.suggestions || [],
    }
  }
)
