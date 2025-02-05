import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { PlanSchema } from 'llamautoma-types'
import type { Feedback, Plan } from 'llamautoma-types'
import { getMessageString } from './lib'

// Create planner with structured output
const planner = createStructuredLLM<Plan>(PlanSchema)

// Create the planner task
export const plannerTask = task(
  'planner',
  async ({
    messages,
    feedback,
  }: {
    messages: BaseMessage[]
    feedback?: Feedback
  }): Promise<Plan> => {
    // Combine messages into context
    const context = messages.map(msg => getMessageString(msg)).join('\n')

    // Generate plan using structured LLM
    const result = await planner.invoke(
      `Given the following conversation, create a detailed plan to fulfill the user's request.
${feedback ? `\nPrevious attempt feedback: ${feedback.feedback}` : ''}

Conversation:
${context}

Requirements:
1. Break down the task into clear, numbered steps
2. Identify any required searches or file patterns
3. Specify tool requirements
4. Choose appropriate task type (code/search/chat)

Plan:`
    )

    return {
      type: result.type,
      steps: result.steps,
      tools: result.tools,
      patterns: result.patterns,
      approved: feedback?.approved ?? false,
      feedback: feedback?.feedback,
      metadata: result.metadata,
    }
  }
)
