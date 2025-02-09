import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'

/**
 * Types of messages that can be sent from server to client
 */
export type ServerToClientMessageType =
  | 'edit'
  | 'run'
  | 'chat'
  | 'status'
  | 'progress'
  | 'task'
  | 'code'
  | 'complete'

/**
 * Types of messages that can be sent from client to server
 */
export type ClientToServerMessageType = 'input' | 'cancel' | 'confirm' | 'reject'

/**
 * Message sent from server to client
 */
export interface ServerToClientMessage {
  type: ServerToClientMessageType
  content?: string
  data?: unknown
  messages?: BaseMessage[]
  response?: unknown
  metadata?: Record<string, unknown>
  timestamp: number
}

/**
 * Message sent from client to server
 */
export interface ClientToServerMessage {
  type: ClientToServerMessageType
  data: unknown
  metadata?: Record<string, unknown>
  timestamp: number
}

/**
 * Schema for stream events
 */
export const StreamEventSchema = z.object({
  type: z.enum(['edit', 'run', 'chat', 'status', 'progress', 'task', 'code', 'complete']),
  content: z.string().optional(),
  data: z.unknown().optional(),
  messages: z.array(z.any()).optional(),
  response: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.number(),
})

export type StreamEvent = z.infer<typeof StreamEventSchema>
