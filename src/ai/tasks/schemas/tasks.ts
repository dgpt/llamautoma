import { z } from 'zod'
import { FileSchema } from '../../tools/schemas/file'

/**
 * Schema for task response content shown in the chat window
 */
export const TaskResponseContentSchema = z.object({
  content: z.string().describe('The actual content/message to be displayed in the chat window'),
  type: z.enum(['info', 'warning', 'error', 'success', 'code', 'plan', 'review', 'progress'])
    .describe('The type of response, used for styling and handling in the client'),
  shouldDisplay: z.boolean()
    .describe('Whether this response should be displayed in the chat window')
    .default(true),
  metadata: z.record(z.any())
    .optional()
    .describe('Additional metadata about the response that may be used by the client'),
  timestamp: z.number()
    .default(() => Date.now())
    .describe('Timestamp when the response was generated'),
  priority: z.number()
    .min(0)
    .max(100)
    .default(50)
    .describe('Priority of the message for display ordering (0-100, higher = more important)'),
})

/**
 * Base schema that all tasks extend from
 */
export const BaseTaskSchema = z.object({
  response: TaskResponseContentSchema.describe('Response data to be shown in the chat window'),
  streamResponses: z
    .array(TaskResponseContentSchema)
    .describe('Array of responses that should be streamed to the client during task execution')
    .default([]),
})

/**
 * Schema for planner task results
 */
export const PlannerTaskSchema = BaseTaskSchema.extend({
  plan: z.string(),
  steps: z
    .array(
      z.object({
        step: z.string(),
        description: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed', 'error']).default('pending'),
      })
    )
    .optional(),
})

/**
 * Schema for reviewer task results
 */
export const ReviewerTaskSchema = BaseTaskSchema.extend({
  approved: z.boolean(),
  feedback: z.string().optional(),
  suggestions: z
    .array(
      z.object({
        step: z.string(),
        action: z.string(),
        priority: z.enum(['high', 'medium', 'low']).default('medium'),
      })
    )
    .optional(),
  metrics: z
    .object({
      quality: z.number().min(0).max(100).optional(),
      coverage: z.number().min(0).max(100).optional(),
      complexity: z.number().min(0).max(100).optional(),
    })
    .optional(),
})

/**
 * Schema for coder task results
 */
export const CoderTaskSchema = BaseTaskSchema.extend({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      type: z.enum(['create', 'modify', 'delete']),
      description: z.string().optional(),
      language: z.string().optional(),
      size: z.number().optional(),
    })
  ),
  dependencies: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        type: z.enum(['required', 'optional', 'dev']).default('required'),
      })
    )
    .optional(),
  stats: z
    .object({
      totalFiles: z.number(),
      totalLines: z.number(),
      filesChanged: z.array(z.string()),
    })
    .optional(),
})

/**
 * Schema for summarizer task output
 */
export const SummarizerTaskSchema = BaseTaskSchema.extend({
  summary: z.string(),
  messages: z.array(z.any()), // BaseMessage type from langchain
})

export type PlannerTaskOutput = z.infer<typeof PlannerTaskSchema>
export type ReviewerTaskOutput = z.infer<typeof ReviewerTaskSchema>
export type CoderTaskOutput = z.infer<typeof CoderTaskSchema>
export type SummarizerTaskOutput = z.infer<typeof SummarizerTaskSchema>
