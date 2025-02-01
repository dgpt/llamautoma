import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint'

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
