import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'
import { entrypoint, task } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { llm } from '../llm'
import { plannerTask } from './planner'
import { reviewerTask } from './reviewer'
import { coderTask } from './coder'
import { diffTask } from './diff'
import { summarizerTask } from './summarizer'
import { logger } from '@/logger'

// Schema for workflow output
export const workflowOutputSchema = z.object({
  messages: z.array(z.any()),
  threadId: z.string(),
  checkpoint: z.string(),
  status: z.enum(['success', 'error', 'in_progress']),
  toolFeedback: z.record(z.string(), z.any()).optional(),
  iterations: z.number(),
})

export type WorkflowOutput = z.infer<typeof workflowOutputSchema>

// Create the workflow
export const workflow = entrypoint(
  { checkpointer: new MemorySaver(), name: 'llamautoma' },
  async (inputs: {
    messages: BaseMessage[]
    threadId?: string
    checkpoint?: string
    maxIterations?: number
  }) => {
    const {
      messages,
      threadId = Bun.randomUUIDv7(),
      checkpoint = 'llamautoma',
      maxIterations = 10,
    } = inputs
    let iterations = 0
    let currentMessages = messages
    let status: WorkflowOutput['status'] = 'in_progress'
    let toolFeedback: Record<string, any> = {}

    try {
      // Step 1: Summarize if context is too long
      if (currentMessages.length > 10) {
        const summary = await summarizerTask({ messages: currentMessages })
        currentMessages = summary.messages
      }

      // Step 2: Plan generation and review loop
      let plan = await plannerTask({ messages: currentMessages })
      while (!plan.approved && iterations < maxIterations) {
        const review = await reviewerTask({ messages: currentMessages, plan })
        if (!review.approved) {
          plan = await plannerTask({ messages: currentMessages, feedback: review.feedback })
          iterations++
        } else {
          break
        }
      }

      // Step 3: Code generation and review loop
      let code = await coderTask({ messages: currentMessages, plan })
      while (!code.approved && iterations < maxIterations) {
        const review = await reviewerTask({ messages: currentMessages, code })
        if (!review.approved) {
          code = await coderTask({ messages: currentMessages, feedback: review.feedback })
          iterations++
        } else {
          break
        }
      }

      // Step 4: Generate diff
      const diff = await diffTask({ messages: currentMessages, code })

      status = 'success'
      toolFeedback = {
        plan: plan.feedback,
        code: code.feedback,
        diff: diff.feedback,
      }

      return {
        messages: currentMessages,
        threadId,
        checkpoint,
        status,
        toolFeedback,
        iterations,
      }
    } catch (error) {
      logger.error('Workflow failed', { error })
      status = 'error'
      return {
        messages: currentMessages,
        threadId,
        checkpoint,
        status,
        toolFeedback,
        iterations,
      }
    }
  }
)
