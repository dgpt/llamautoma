import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { PlanSchema } from 'llamautoma-types'
import type { Feedback, Plan } from 'llamautoma-types'
import { getMessageString } from './lib'
import { RunnableConfig } from '@langchain/core/runnables'

// Create planner with structured output
const planner = createStructuredLLM<Plan>(PlanSchema)

// Create the planner task
export const plannerTask = async ({
  messages,
  feedback,
  config,
}: {
  messages: BaseMessage[]
  feedback?: Feedback
  config?: RunnableConfig
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

The response should be a JSON object with the following format:
{
  "type": "code" | "search" | "chat",
  "steps": [
    "1. First step description",
    "2. Second step description",
    "3. Third step description"
  ],
  "tools": ["tool1", "tool2", ...] (optional),
  "patterns": ["pattern1", "pattern2", ...] (optional),
  "metadata": { ... } (optional)
}

Note: Each step should be a simple string describing the action, not an object.

Plan:`,
    config
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
