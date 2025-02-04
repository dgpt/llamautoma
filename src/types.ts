import { z } from 'zod'
import { RunnableConfig as LangChainRunnableConfig } from '@langchain/core/runnables'

// Basic message schemas
export const MessageSchema = z.object({
  role: z.string(),
  content: z.string(),
})

export const MessagesSchema = z.array(MessageSchema).min(1, 'At least one message is required')

// Safety configuration schema and types
export const SafetyConfigSchema = z
  .object({
    requireToolConfirmation: z.boolean().default(true).optional(),
    requireToolFeedback: z.boolean().default(true).optional(),
    maxInputLength: z.number().min(1).default(8192).optional(),
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
  })
  .optional()

// Default agent configuration
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

// Base schema for all requests
export const BaseRequestSchema = z.object({
  threadId: z.string().optional(),
  checkpoint: z.string().optional(),
  modelName: z.string().optional(),
  host: z.string().optional(),
  safetyConfig: SafetyConfigSchema,
})

export type BaseRequest = z.infer<typeof BaseRequestSchema>

// Chat/Edit/Compose request schema
export const ChatRequestSchema = BaseRequestSchema.extend({
  messages: MessagesSchema,
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>

// Sync request schema
export const SyncRequestSchema = BaseRequestSchema.extend({
  root: z.string(),
  excludePatterns: z.array(z.string()).optional(),
})

export type SyncRequest = z.infer<typeof SyncRequestSchema>

export interface SafetyConfig {
  requireToolConfirmation: boolean
  requireToolFeedback: boolean
  maxInputLength: number
  dangerousToolPatterns: string[]
}

export interface SafetyCheckResult {
  passed: boolean
  reason?: string
  warnings?: string[]
}

// Tool execution types
export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: Error
  safetyResult?: SafetyCheckResult
}

export interface UserInteractionResult {
  confirmed: boolean
  feedback?: string
}

// Base runnable configuration
export interface RunnableConfig extends Omit<LangChainRunnableConfig, 'configurable'> {
  modelName: string
  host: string
  threadId?: string
  checkpoint?: string
  safetyConfig?: SafetyConfig
  memoryPersist?: boolean
  configurable?: {
    thread_id: string
    checkpoint_ns: string
    [Symbol.toStringTag]: string
  }
}
