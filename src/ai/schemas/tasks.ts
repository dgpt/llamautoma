import { z } from 'zod'
import { FileSchema } from './files'

/**
 * Base task schema that all tasks extend from
 */
export const BaseTaskSchema = z.object({
  response: z.string().describe('Message to show in chat window'),
})

/**
 * Schema for planner task output
 */
export const PlannerTaskSchema = BaseTaskSchema.extend({
  plan: z.string().describe('Generated plan steps'),
})

/**
 * Schema for reviewer task output
 */
export const ReviewerTaskSchema = BaseTaskSchema.extend({
  approved: z.boolean(),
  feedback: z.string().optional(),
  suggestions: z
    .array(
      z.object({
        step: z.string(),
        action: z.string(),
      })
    )
    .optional(),
})

/**
 * Schema for coder task output
 */
export const CoderTaskSchema = BaseTaskSchema.extend({
  files: z.array(FileSchema),
  explanation: z.string(),
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
