import { Tool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { z } from 'zod'
import { SafetyConfig } from './safety'

// Core agent state interface
export interface AgentState {
  messages: BaseMessage[]
  iterations: number
  status: 'continue' | 'end'
  modelResponse: BaseMessage | null
  action: { name: string; arguments: any } | null
  isFinalAnswer: boolean
  observation: string | null
  safetyConfig: SafetyConfig
  toolFeedback: Record<string, any>
  userConfirmed: boolean
  tools: Tool[]
  chatModel: BaseChatModel
  maxIterations: number
  threadId: string
  configurable: {
    thread_id: string
    checkpoint_ns: string
    [Symbol.toStringTag]: 'AgentConfigurable'
    [key: string]: unknown
  }
  streamComplete?: boolean
}

export interface AgentInput {
  messages: BaseMessage[]
  configurable?: {
    thread_id?: string
    checkpoint_ns?: string
    [Symbol.toStringTag]?: 'AgentConfigurable'
    [key: string]: unknown
  }
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, any>
  iterations: number
  threadId: string
  configurable: {
    thread_id: string
    checkpoint_ns: string
    [Symbol.toStringTag]: 'AgentConfigurable'
    [key: string]: unknown
  }
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
  host: z.string().default('http://localhost:11434'),
  tools: z.array(z.instanceof(Tool)),
  threadId: z.string(),
  memoryPersistence: z.instanceof(MemorySaver).default(() => new MemorySaver()),
  maxIterations: z.number().min(1).max(30).default(10),
  userInputTimeout: z.number().min(0).max(36000).default(300),
  chatModel: z.instanceof(BaseChatModel).optional(),
  safetyConfig: z.object({
    requireToolConfirmation: z.boolean().default(true),
    requireToolFeedback: z.boolean().default(true),
    maxInputLength: z.number().min(1).max(16384).default(8192),
    dangerousToolPatterns: z.array(z.string()).default([
      'drop', 'truncate', 'exec', 'curl', 'wget', 'bash -c', 'rm  -rf /', 'zsh -c', 'sh -c'
    ])
  }),
  configurable: z.object({
    thread_id: z.string(),
    checkpoint_ns: z.string(),
    [Symbol.toStringTag]: z.literal('AgentConfigurable')
  }).passthrough()
})

export type FunctionalReActConfig = z.infer<typeof FunctionalReActConfigSchema>

