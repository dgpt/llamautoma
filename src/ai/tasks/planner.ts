import { task } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { PlannerTaskSchema } from './schemas/tasks'
import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { updateProgress, sendTaskResponse, sendTaskComplete } from '../utils/stream'

/**
 * Creates a plan for code generation based on user request
 */
export const plannerTask = task('planner', async (messages: BaseMessage[], config?: RunnableConfig) => {
  // Update initial progress
  updateProgress('planner', 'Creating plan...', config)

  // Convert messages to string for context
  const context = messages.map(getMessageString).join('\n')

  // Generate plan using LLM
  const response = await llm.invoke(
    `Based on the following conversation, create a plan for implementing the user's request:

      ${context}

      Respond with:
      1. A clear explanation of what needs to be done
      2. Step by step plan for implementation
      3. Any potential challenges or considerations

      Keep the response concise but informative.`
  )

  // Parse response into sections
  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
  const [explanation, ...planSteps] = content.split('\n\n')

  // Send explanation to chat window
  sendTaskResponse('planner', explanation)

  // Create structured response
  const result = PlannerTaskSchema.parse({
    plan: planSteps.join('\n\n'),
    response: explanation, // This will be shown in the chat window
  })

  // Update progress with completion
  sendTaskComplete('planner', 'Plan created')

  return result
})
