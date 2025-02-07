import { z } from 'zod'

/**
 * Base event schema that all events must follow
 */
export const BaseEventSchema = z.object({
  type: z.enum(['response', 'progress', 'error', 'complete']),
  task: z.string(),
  timestamp: z.number(),
})

/**
 * Schema for response events (content shown in chat)
 */
export const ResponseEventSchema = BaseEventSchema.extend({
  type: z.literal('response'),
  content: z.string(),
  metadata: z.record(z.any()).optional(),
})

/**
 * Schema for progress events (shown at bottom of chat)
 */
export const ProgressEventSchema = BaseEventSchema.extend({
  type: z.literal('progress'),
  status: z.string(),
})

/**
 * Schema for error events
 */
export const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: z.string(),
})

/**
 * Schema for completion events
 */
export const CompleteEventSchema = BaseEventSchema.extend({
  type: z.literal('complete'),
  final_status: z.string().optional(),
})

/**
 * Union of all possible event types
 */
export const StreamEventSchema = z.discriminatedUnion('type', [
  ResponseEventSchema,
  ProgressEventSchema,
  ErrorEventSchema,
  CompleteEventSchema,
])

export type StreamEvent = z.infer<typeof StreamEventSchema>
export type ResponseEvent = z.infer<typeof ResponseEventSchema>
export type ProgressEvent = z.infer<typeof ProgressEventSchema>
export type ErrorEvent = z.infer<typeof ErrorEventSchema>
export type CompleteEvent = z.infer<typeof CompleteEventSchema>
