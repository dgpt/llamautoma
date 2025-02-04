import { BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { RunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod'

// Shared schemas
export const ConfigurableSchema = z.object({
  thread_id: z.string(),
  checkpoint_ns: z.string(),
  [Symbol.toStringTag]: z.literal('AgentConfigurable'),
}).passthrough().optional()

export const SafetyConfigSchema = z.object({
  requireToolConfirmation: z.boolean().default(true).optional(),
  requireToolFeedback: z.boolean().default(true).optional(),
  maxInputLength: z.number().min(1).max(16384).default(8192).optional(),
  dangerousToolPatterns: z
    .array(z.string())
    .default([
      'drop',
      'truncate',
      'exec',
      'curl',
      'wget',
      'bash -c',
      'rm  -rf /',
      'zsh -c',
      'sh -c',
    ])
    .optional(),
}).optional()

export const MessageSchema = z.object({
  role: z.string(),
  content: z.string(),
})

export const MessagesSchema = z.array(MessageSchema).min(1, 'At least one message is required')

// Base schema for all requests
export const BaseRequestSchema = z.object({
  threadId: z.string().optional(),
  modelName: z.string().optional(),
  host: z.string().optional(),
  safetyConfig: SafetyConfigSchema,
  configurable: ConfigurableSchema,
})

// Chat/Edit/Compose request schema
export const ChatRequestSchema = BaseRequestSchema.extend({
  messages: MessagesSchema,
})

// Sync request schema
export const SyncRequestSchema = BaseRequestSchema.extend({
  root: z.string(),
  excludePatterns: z.array(z.string()).optional(),
})

// Configuration schema with strong typing
export const FunctionalReActConfigSchema = BaseRequestSchema.extend({
  memoryPersistence: z
    .instanceof(MemorySaver)
    .default(() => new MemorySaver())
    .optional(),
  maxIterations: z.number().min(1).max(30).default(10).optional(),
  userInputTimeout: z.number().min(0).max(36000).default(300).optional(),
  chatModel: z.instanceof(BaseChatModel).optional(),
}).transform(data => ({
  ...data,
  modelName: data.modelName || 'qwen2.5-coder:7b',
  host: data.host || 'http://localhost:11434',
}))

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
  configurable: AgentConfigurable
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
  configurable?: AgentConfigurable
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, unknown>
  iterations: number
  threadId: string
  configurable: AgentConfigurable
}

export interface SafetyCheckResult {
  passed: boolean
  reason?: string
  warnings?: string[]
}

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: Error
  safetyResult?: SafetyCheckResult
}

/**
 * Safety configuration for the agent
 */
export interface SafetyConfig {
  /** Whether tool executions require user confirmation */
  requireToolConfirmation: boolean
  /** Whether tool executions require user feedback */
  requireToolFeedback: boolean
  /** Maximum length of input text */
  maxInputLength: number
  /** Patterns that indicate potentially dangerous tool usage */
  dangerousToolPatterns: string[]
}

export interface UserInteractionResult {
  confirmed: boolean
  feedback?: string
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

export type FunctionalReActConfig = z.infer<typeof FunctionalReActConfigSchema>

export type AgentMode = 'test' | 'production'

export interface AgentConfig {
  openaiApiKey: string
  model?: string
  temperature?: number
}

export const DEFAULT_AGENT_CONFIG = {
  modelName: 'qwen2.5-coder:1.5b',
  host: 'http://localhost:11434',
  maxIterations: 10,
  userInputTimeout: 30000,
  safetyConfig: {
    requireToolConfirmation: true,
    requireToolFeedback: true,
    maxInputLength: 8192,
    dangerousToolPatterns: [
      'rm -rf /',
      'DROP TABLE',
      'sudo rm',
      'wget http',
      'curl',
      'exec',
      'bash -c',
      'zsh -c',
      'sh -c',
    ],
  },
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
