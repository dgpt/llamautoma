import { Tool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { z } from 'zod'

// Core agent state interface
export interface AgentState {
  messages: BaseMessage[]
  iterations: number
  status: 'continue' | 'end'
  modelResponse: BaseMessage | null
  action: { name: string; arguments: string } | null
  isFinalAnswer: boolean
  observation: string | null
  safetyConfig: AgentSafetyConfig
  toolFeedback: Record<string, string>
  userConfirmed: boolean
  tools: Tool[]
  chatModel: BaseChatModel
  maxIterations: number
  threadId: string
  configurable?: {
    signal?: AbortSignal
    thread_id?: string
    checkpoint_ns?: string
    [key: string]: unknown
  }
}

export interface AgentInput {
  messages: BaseMessage[]
  configurable?: {
    signal?: AbortSignal
    thread_id?: string
    checkpoint_ns?: string
    [key: string]: unknown
  }
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, string>
  iterations: number
  threadId: string
  configurable: {
    thread_id: string
    checkpoint_ns: string
    [key: string]: unknown
  }
}

export interface AgentSafetyConfig {
  requireToolConfirmation: boolean
  requireToolFeedback: boolean
  maxInputLength: number
  dangerousToolPatterns: string[]
}

export interface SafetyCheckResult {
  passed: boolean
  reason?: string
}

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: Error
  safetyResult?: SafetyCheckResult
}

// Configuration schema with strong typing
export const FunctionalReActConfigSchema = z.object({
  modelName: z.string().default('qwen2.5-coder:7b'),
  host: z.string().url().default('http://localhost:8000'),
  tools: z.array(z.instanceof(Tool)).default([]),
  maxIterations: z.number().min(1).max(30).default(10),
  threadId: z.string(),
  chatModel: z.instanceof(BaseChatModel).optional(),
  memoryPersistence: z.instanceof(MemorySaver).default(() => new MemorySaver()),
  userInputTimeout: z.number().min(0).max(36000).default(300),
  safetyConfig: z.object({
    requireToolConfirmation: z.boolean(),
    requireToolFeedback: z.boolean(),
    maxInputLength: z.number(),
    dangerousToolPatterns: z.array(z.string())
  }).transform((val) => ({
    requireToolConfirmation: val.requireToolConfirmation ?? true,
    requireToolFeedback: val.requireToolFeedback ?? true,
    maxInputLength: val.maxInputLength ?? 10000,
    dangerousToolPatterns: val.dangerousToolPatterns ?? [
      'drop', 'truncate', 'exec', 'curl', 'wget', 'bash -c', 'rm  -rf /', 'zsh -c', 'sh -c'
    ]
  }))
})

export type FunctionalReActConfig = z.infer<typeof FunctionalReActConfigSchema>
