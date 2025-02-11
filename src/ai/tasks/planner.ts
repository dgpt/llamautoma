import { task } from '@langchain/langgraph'
import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { PlannerTaskSchema, type PlannerTaskOutput } from './schemas/tasks'
import { createStructuredLLM } from '../llm'
import { TaskType } from '@/types'
import type { Config } from '@/types'
import { DEFAULT_CONFIG } from '@/config'
import { z } from 'zod'

// Define response types as enum for better type safety
export enum ResponseType {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Success = 'success',
  Code = 'code',
  Plan = 'plan',
  Review = 'review',
  Progress = 'progress',
}

// Schema for LLM response
const LLMResponseSchema = z.object({
  explanation: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      description: z.string(),
    })
  ),
})

type LLMResponse = z.infer<typeof LLMResponseSchema>

/**
 * Creates a plan for code generation based on user request
 */
export const plannerTask = task(
  'planner',
  async (
    input: { messages: BaseMessage[]; config?: Config },
    runConfig?: RunnableConfig
  ): Promise<PlannerTaskOutput> => {
    // Validate input
    if (!input.messages?.length) {
      throw new Error('No messages provided to planner task')
    }

    // Add planning instructions
    const messages = [
      ...input.messages,
      new SystemMessage({
        content: `Create a detailed plan for implementing the user's request.
The response MUST be valid JSON with this structure:

{
  "explanation": "Detailed explanation of what needs to be done",
  "steps": [
    {
      "step": "1",
      "description": "Detailed step description"
    }
  ]
}

Guidelines:
1. The explanation should be clear and actionable
2. Break down complex tasks into smaller steps
3. Consider potential challenges and edge cases
4. Include any necessary setup or prerequisites`,
      }),
    ]

    // Create structured LLM for planning
    const llm = createStructuredLLM<LLMResponse>(
      LLMResponseSchema,
      TaskType.Plan,
      input.config || DEFAULT_CONFIG
    )

    // Generate plan using structured LLM
    const result = await llm.invoke(messages, runConfig)

    // Format result into PlannerTaskOutput
    const output: PlannerTaskOutput = {
      plan: result.explanation,
      steps: result.steps.map((step: { step: string; description: string }) => ({
        ...step,
        status: 'pending',
      })),
      response: {
        type: ResponseType.Plan,
        content: result.explanation,
        shouldDisplay: true,
        timestamp: Date.now(),
      },
      streamResponses: [
        {
          type: ResponseType.Progress,
          content: 'Creating plan...',
          shouldDisplay: true,
          timestamp: Date.now(),
        },
        ...result.steps.map((step: { step: string; description: string }) => ({
          type: ResponseType.Plan,
          content: `Step ${step.step}: ${step.description}`,
          shouldDisplay: true,
          timestamp: Date.now(),
        })),
        {
          type: ResponseType.Progress,
          content: 'Plan created successfully',
          shouldDisplay: true,
          timestamp: Date.now(),
        },
      ],
    }

    // Validate output matches schema
    return PlannerTaskSchema.parse(output)
  }
)
