import { workflow } from './tasks/router'
import type {
  WorkflowState,
  BaseResponse,
  PlanSchema,
  GeneratedCodeSchema,
  ReviewSchema,
  FeedbackSchema,
} from 'llamautoma-types'

// Re-export all schemas
export {
  PlanSchema as planSchema,
  GeneratedCodeSchema as codeSchema,
  ReviewSchema as reviewSchema,
  FeedbackSchema as feedbackSchema,
}

// Export workflow types
export interface WorkflowInput extends Omit<WorkflowState, 'id'> {
  threadId?: string
  checkpoint?: string
  maxIterations?: number
}

// Export the workflow
export const llamautoma = {
  workflow,
  invoke: async (input: WorkflowInput): Promise<BaseResponse> => {
    return await workflow.invoke(
      {
        ...input,
        id: input.threadId || crypto.randomUUID(),
      },
      {
        configurable: {
          thread_id: input.threadId,
          checkpoint_ns: input.checkpoint,
        },
      }
    )
  },
  stream: async function* (input: WorkflowInput) {
    const stream = await workflow.stream(
      {
        ...input,
        id: input.threadId || crypto.randomUUID(),
      },
      {
        configurable: {
          thread_id: input.threadId,
          checkpoint_ns: input.checkpoint,
        },
      }
    )

    for await (const chunk of stream) {
      yield chunk
    }
  },
}
