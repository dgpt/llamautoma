import { BaseMessage } from '@langchain/core/messages'
import { workflow, WorkflowOutput } from './tasks/router'
import { planSchema } from './tasks/planner'
import { codeSchema } from './tasks/coder'
import { reviewSchema } from './tasks/reviewer'
import { diffSchema } from './tasks/diff'
import { searchSchema, extractionSchema } from './tasks/search'
import { feedbackSchema } from './llm'

// Re-export all schemas
export {
  planSchema,
  codeSchema,
  reviewSchema,
  diffSchema,
  searchSchema,
  extractionSchema,
  feedbackSchema,
}

// Export workflow types
export interface WorkflowInput {
  messages: BaseMessage[]
  threadId?: string
  checkpoint?: string
  maxIterations?: number
}

export type { WorkflowOutput }

// Export the workflow
export const llamautoma = {
  workflow,
  invoke: async (input: WorkflowInput): Promise<WorkflowOutput> => {
    return await workflow.invoke(input, {
      configurable: {
        thread_id: input.threadId,
        checkpoint_ns: input.checkpoint,
      },
    })
  },
  stream: async function* (input: WorkflowInput) {
    const stream = await workflow.stream(input, {
      configurable: {
        thread_id: input.threadId,
        checkpoint_ns: input.checkpoint,
      },
    })

    for await (const chunk of stream) {
      yield chunk
    }
  },
}
