import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { createStructuredLLM } from '../llm'
import { PlanSchema } from 'llamautoma-types'
import type { Review, Plan } from 'llamautoma-types'
import { getMessageString } from './lib'
import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { logger } from '@/logger'

// Create planner with structured output
const planner = createStructuredLLM<Plan>(PlanSchema)

// Create the planner task
export const plannerTask = async ({
  messages,
  review,
}: {
  messages: BaseMessage[]
  review?: Review
}): Promise<Plan> => {
  // Combine messages into context
  const context = messages.map(msg => getMessageString(msg)).join('\n')
  const parser = StructuredOutputParser.fromZodSchema(PlanSchema)
  const formatInstructions = parser.getFormatInstructions()

  logger.debug(`Planner invoked with messages: ${context}`)
  if (review) {
    logger.debug(`Previous review: ${JSON.stringify(review)}`)
  }

  // Generate plan using structured LLM
  const result = await planner.invoke([
    new SystemMessage(formatInstructions),
    new SystemMessage(
      `You are a code planning assistant. Your job is to break down code tasks into clear, actionable steps.

${review ? `Previous review feedback: ${review.feedback}\n${review.suggestions?.map(s => `- ${s.step}: ${s.action}`).join('\n')}\n` : ''}
Conversation:
${context}

When planning code changes:
1. Break down the task into clear steps
2. Include file patterns and dependencies
3. Consider error handling and testing

Example format:
{
  "response": "I'll help you implement [feature]. Here's the plan:",
  "steps": [
    "Create file src/components/Counter.tsx",
    "Add React component structure",
    "Implement state management",
    "Add increment/decrement functions",
    "Style the component",
    "Add error handling",
    "Write tests"
  ]
}
`
    ),
  ])

  logger.debug(`Planner response: ${JSON.stringify(result)}`)
  return {
    response: result.response,
    steps: result.steps,
  }
}
