import { z } from 'zod'

/**
 * Base event schema that all events must follow
 */
export const BaseEventSchema = z.object({
  type: z.enum(['response', 'progress', 'error', 'complete']).describe('Type of stream event'),
  task: z.string().describe('Task that generated this event'),
  timestamp: z.number().describe('When the event was generated'),
})

/**
 * Schema for response events (shown in chat window)
 */
export const ResponseEventSchema = BaseEventSchema.extend({
  type: z.literal('response'),
  content: z.string().describe('Content to display'),
  metadata: z.record(z.any()).optional().describe('Optional metadata about the response'),
})

/**
 * Schema for progress events (shown at bottom of chat)
 */
export const ProgressEventSchema = BaseEventSchema.extend({
  type: z.literal('progress'),
  status: z.string().describe('Current status message'),
})

/**
 * Schema for error events
 */
export const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: z.string().describe('Error message'),
})

/**
 * Schema for completion events
 */
export const CompleteEventSchema = BaseEventSchema.extend({
  type: z.literal('complete'),
  final_status: z.string().optional().describe('Final status message'),
  responses: z.array(z.any()).optional().describe('Collection of responses from the task'),
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
