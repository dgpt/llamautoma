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
 * Response event schema
 */
export const ResponseEventSchema = BaseEventSchema.extend({
  type: z.literal('response'),
  content: z.string().describe('Response content'),
  metadata: z.record(z.any()).optional().describe('Optional metadata'),
})

/**
 * Progress event schema
 */
export const ProgressEventSchema = BaseEventSchema.extend({
  type: z.literal('progress'),
  status: z.string().describe('Progress status message'),
})

/**
 * Error event schema
 */
export const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: z.string().describe('Error message'),
  stack: z.string().optional().describe('Optional stack trace'),
})

/**
 * Complete event schema
 */
export const CompleteEventSchema = BaseEventSchema.extend({
  type: z.literal('complete'),
  summary: z.string().optional().describe('Optional completion summary'),
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

/**
 * Client-server streaming message schema
 */
export const StreamMessageSchema = z.object({
  event: z.enum(['start', 'content', 'end']).describe('Message event type'),
  threadId: z.string().optional().describe('Optional thread ID'),
  data: z.any().optional().describe('Message data'),
  timestamp: z.number().describe('Message timestamp'),
})

export type StreamMessage = z.infer<typeof StreamMessageSchema>
