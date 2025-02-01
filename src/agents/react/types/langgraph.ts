import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint'
import { Tool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatOllama } from '@langchain/ollama'
import { MemorySaver } from '@langchain/langgraph-checkpoint'

/**
 * Memory state type
 */
export interface MemoryState {
  messages: BaseMessage[]
  relevantHistory: string[]
  timestamp?: number
  [key: string]: unknown
}

/**
 * Memory checkpoint type
 */
export interface MemoryCheckpoint {
  messages: BaseMessage[]
  timestamp: number
  metadata?: {
    source?: string
    step?: number
    [key: string]: unknown
  }
}

/**
 * Memory configuration type
 */
export interface MemoryConfig {
  checkpoint_ns?: string
  thread_id?: string
  contextWindow?: number
  maxAge?: number
  maxEntries?: number
  [key: string]: unknown
}

/**
 * Memory checkpoint options
 */
export interface CheckpointOptions {
  thread_id: string
  checkpoint_ns: string
}

/**
 * Extended MemorySaver interface
 */
export interface ExtendedMemorySaver {
  saveCheckpoint: (checkpoint: MemoryCheckpoint, options: CheckpointOptions) => Promise<void>
  getCheckpoint: (options: CheckpointOptions) => Promise<MemoryCheckpoint | null>
}

/**
 * Memory result type
 */
export interface MemoryResult {
  messages: BaseMessage[]
  relevantHistory: string[]
  memorySaved?: boolean
  cleaned?: boolean
}

/**
 * Task result type
 */
export interface TaskResult<T> {
  invoke: (state: MemoryState) => Promise<T>
}

/**
 * Memory manager type
 */
export interface MemoryManager {
  name: string
  invoke: (state: MemoryState, config?: RunnableConfig) => Promise<MemoryResult>
}

export interface Configurable {
  thread_id: string
  checkpoint_ns: string
  [Symbol.toStringTag]: 'AgentConfigurable'
  [key: string]: unknown
}

export interface AgentState {
  messages: BaseMessage[]
  iterations: number
  status: 'continue' | 'end'
  isFinalAnswer: boolean
  safetyConfig: {
    requireToolConfirmation?: boolean
    requireToolFeedback?: boolean
    maxInputLength?: number
    dangerousToolPatterns?: string[]
  }
  tools: Tool[]
  chatModel: ChatOllama
  maxIterations: number
  threadId: string
  configurable: Configurable
  modelResponse: BaseMessage
  action: { name: string; arguments: unknown } | null
  observation: string | null
  toolFeedback: Record<string, unknown>
  userConfirmed: boolean
}

export interface AgentInput {
  messages?: BaseMessage[]
  configurable?: Partial<Configurable>
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, unknown>
  iterations: number
  threadId: string
  configurable: Configurable
}

export interface FunctionalReActConfig {
  modelName?: string
  host?: string
  tools: Tool[]
  threadId: string
  memoryPersistence?: MemorySaver
  maxIterations: number
  userInputTimeout?: number
  safetyConfig?: {
    requireToolConfirmation?: boolean
    requireToolFeedback?: boolean
    maxInputLength?: number
    dangerousToolPatterns?: string[]
  }
  chatModel?: ChatOllama
  configurable?: Partial<Configurable>
}
