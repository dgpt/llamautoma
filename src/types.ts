import { RunnableConfig as LangChainRunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod'
import type { Config as BaseConfig, LLMConfig } from './types/config'

// Re-export config types with extensions
export interface Config extends BaseConfig {
  configurable?: {
    thread_id: string
    checkpoint_ns: string
    [Symbol.toStringTag]: string
  }
}

export type { LLMConfig }

// Re-export LangChain types with extensions
export interface RunnableConfig extends Omit<LangChainRunnableConfig, 'configurable'> {
  config: Config
  threadId?: string
  checkpoint?: string
  memoryPersist?: boolean
}

// Task types
export enum TaskType {
  Code = 'code',
  Intent = 'intent',
  Plan = 'plan',
  Review = 'review',
  Summarize = 'summarize',
}

// Request schemas
export const SyncRequestSchema = z.object({
  root: z.string(),
  excludePatterns: z.array(z.string()).optional(),
})

export type SyncRequest = z.infer<typeof SyncRequestSchema>

// Streaming response types
export type StreamingResponse = {
  type: 'start' | 'content' | 'end' | 'error'
  data?: string
  error?: string
  metadata?: Record<string, unknown>
}
