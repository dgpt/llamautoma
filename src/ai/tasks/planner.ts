import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import type { Feedback } from '../llm'
import { getMessageString } from './utils'

// Schema for plan output
export const planSchema = z.object({
  type: z.enum(['code', 'search', 'chat']),
  steps: z.array(
    z.object({
      id: z.number(),
      description: z.string(),
      requires: z.array(z.number()).optional(),
    })
  ),
  context: z.object({
    search_terms: z.array(z.string()).optional(),
    file_patterns: z.array(z.string()).optional(),
    tool_requirements: z.array(z.string()).optional(),
  }),
  approved: z.boolean(),
  feedback: z.string().optional(),
})

export type Plan = z.infer<typeof planSchema>

// Create planner with structured output
const planner = createStructuredLLM(planSchema)

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
    const plan = await planner.invoke(
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
      ...plan,
      approved: feedback?.approved ?? false,
      feedback: feedback?.feedback,
    }
  }
)
