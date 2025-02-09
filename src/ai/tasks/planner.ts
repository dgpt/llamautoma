import { task } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { PlannerTaskSchema } from './schemas/tasks'
import { llm } from '../llm'
import { getMessageString } from './lib'

/**
 * Creates a plan for code generation based on user request
 */
export const plannerTask = task(
  'planner',
  async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
    // Stream initial progress
    const streamResponses = []
    streamResponses.push({
      type: 'progress',
      content: 'Creating plan...',
      timestamp: Date.now(),
      shouldDisplay: true,
      priority: 50,
    })

    // Convert messages to string for context
    const context = input.messages.map(getMessageString).join('\n')

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

    // Stream explanation to chat
    streamResponses.push({
      type: 'plan',
      content: explanation,
      timestamp: Date.now(),
      shouldDisplay: true,
      priority: 80,
    })

    // Stream each plan step
    planSteps.forEach((step, index) => {
      streamResponses.push({
        type: 'plan',
        content: `Step ${index + 1}: ${step}`,
        timestamp: Date.now(),
        shouldDisplay: true,
        priority: 70,
      })
    })

    // Create final response
    const result = PlannerTaskSchema.parse({
      plan: planSteps.join('\n\n'),
      response: {
        type: 'plan',
        content: explanation,
        timestamp: Date.now(),
        shouldDisplay: true,
        priority: 100,
      },
      streamResponses,
      steps: planSteps.map((step, index) => ({
        step: `${index + 1}`,
        description: step,
        status: 'pending',
      })),
    })

    // Stream completion status
    streamResponses.push({
      type: 'progress',
      content: 'Plan created successfully',
      timestamp: Date.now(),
      shouldDisplay: true,
      priority: 50,
    })

    return result
  }
)
