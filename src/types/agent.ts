import { BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { z } from 'zod'
import { SafetyConfig, RunnableConfig, BaseRequestSchema } from '@/types'

// Shared schemas
export const ConfigurableSchema = z
  .object({
    thread_id: z.string(),
    checkpoint_ns: z.string(),
    [Symbol.toStringTag]: z.literal('AgentConfigurable'),
  })
  .passthrough()
  .optional()

// Configuration schema with strong typing
export const FunctionalReActConfigSchema = BaseRequestSchema.extend({
  memoryPersistence: z
    .instanceof(MemorySaver)
    .default(() => new MemorySaver())
    .optional(),
  maxIterations: z.number().min(1).max(30).default(10).optional(),
  userInputTimeout: z.number().min(0).max(36000).default(300).optional(),
  chatModel: z.instanceof(BaseChatModel).optional(),
})

export type FunctionalReActConfig = z.infer<typeof FunctionalReActConfigSchema>

// Core agent state interface
export interface AgentState {
  messages: BaseMessage[]
  iterations: number
  status: 'continue' | 'end'
  modelResponse: BaseMessage | null
  action: { name: string; arguments: Record<string, unknown> } | null
  isFinalAnswer: boolean
  observation: string | null
  safetyConfig: SafetyConfig
  toolFeedback: Record<string, unknown>
  userConfirmed: boolean
  threadId: string
  checkpoint: string
  streamComplete?: boolean
}

export interface AgentConfigurable {
  thread_id: string
  checkpoint_ns: string
  [Symbol.toStringTag]: 'AgentConfigurable'
  [key: string]: unknown
}

export interface AgentInput {
  messages: BaseMessage[]
  threadId?: string
  checkpoint?: string
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, unknown>
  iterations: number
  threadId: string
  checkpoint: string
}

export interface MemoryManagerConfig {
  persistence: MemorySaver
  namespace: string
  threadId: string
}

export interface ToolExecutorConfig {
  safetyConfig: SafetyConfig
  runConfig?: RunnableConfig
}

export type AgentMode = 'test' | 'production'

export interface AgentConfig {
  openaiApiKey: string
  model?: string
  temperature?: number
}

// Response format schema for ReAct agent
export const ReActResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('thought'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('tool'),
    thought: z.string(),
    action: z.string(),
    args: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('final'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('chat'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('observation'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('confirmation'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('feedback'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('code'),
    language: z.string(),
    code: z.string(),
  }),
  z.object({
    type: z.literal('edit'),
    file: z.string(),
    changes: z.array(
      z.object({
        type: z.enum(['insert', 'update', 'delete']),
        location: z.string(),
        content: z.string(),
      })
    ),
  }),
  z.object({
    type: z.literal('compose'),
    file: z.object({
      path: z.string(),
      content: z.string(),
    }),
  }),
  z.object({
    type: z.literal('sync'),
    file: z.object({
      path: z.string(),
      content: z.string(),
    }),
  }),
])

export type ReActResponse = z.infer<typeof ReActResponseSchema>
