import { task, entrypoint } from '@langchain/langgraph'
import {
  MemorySaver,
  Checkpoint,
  CheckpointMetadata as LangGraphCheckpointMetadata,
} from '@langchain/langgraph-checkpoint'
import { BaseMessage } from '@langchain/core/messages'
import { logger } from '../../../utils/logger'
import { v4 as uuidv4 } from 'uuid'
import { MemoryState, MemoryConfig, MemoryCheckpoint } from '../types/langgraph'

// Constants
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_CONTEXT_WINDOW = 10

// Task to clean up old messages
const cleanupMemory = task(
  'cleanup_memory',
  async (state: MemoryState, config?: { configurable?: MemoryConfig }): Promise<MemoryState> => {
    try {
      const maxAge = config?.configurable?.maxAge ?? DEFAULT_MAX_AGE_MS
      const maxEntries = config?.configurable?.maxEntries ?? DEFAULT_MAX_ENTRIES
      const now = Date.now()

      // Filter out old messages and limit to max entries
      const recentMessages = state.messages
        .filter((msg) => {
          const timestamp = Number(msg.additional_kwargs?.timestamp ?? now)
          return now - timestamp < maxAge
        })
        .slice(-maxEntries)

      return {
        ...state,
        messages: recentMessages,
        cleaned: true,
      }
    } catch (error) {
      logger.error('Error cleaning up memory', { error })
      return state
    }
  }
)

// Task to save state to memory
const saveToMemory = task(
  'save_to_memory',
  async (
    state: MemoryState,
    memoryPersistence: MemorySaver,
    checkpoint_ns: string,
    config?: { configurable?: MemoryConfig }
  ): Promise<MemoryState> => {
    try {
      const effectiveCheckpointNs = config?.configurable?.checkpoint_ns ?? checkpoint_ns
      const now = Date.now()

      // Create checkpoint
      const checkpoint: Checkpoint<string, string> = {
        v: 1,
        id: uuidv4(),
        ts: new Date(now).toISOString(),
        channel_values: {
          memory: JSON.stringify({
            messages: state.messages,
            timestamp: now,
            metadata: {
              source: 'input',
              step: state.messages.length,
            },
          } as MemoryCheckpoint),
        },
        channel_versions: {},
        versions_seen: {},
        pending_sends: [],
      }

      await memoryPersistence.put(
        {
          configurable: {
            checkpoint_ns: effectiveCheckpointNs,
          },
        },
        checkpoint,
        {
          source: 'input',
          step: state.messages.length,
          writes: {},
          parents: {},
        }
      )

      return {
        ...state,
        memorySaved: true,
      }
    } catch (error) {
      logger.error('Error saving to memory', { error })
      return state
    }
  }
)

// Task to load messages from memory
const loadFromMemory = task(
  'load_from_memory',
  async (
    state: MemoryState,
    memoryPersistence: MemorySaver,
    checkpoint_ns: string,
    config?: { configurable?: MemoryConfig }
  ): Promise<MemoryState> => {
    try {
      const effectiveCheckpointNs = config?.configurable?.checkpoint_ns ?? checkpoint_ns
      const contextWindow = config?.configurable?.contextWindow ?? DEFAULT_CONTEXT_WINDOW

      const checkpoint = await memoryPersistence.get({
        configurable: {
          checkpoint_ns: effectiveCheckpointNs,
        },
      })

      if (checkpoint && checkpoint.channel_values && typeof checkpoint.channel_values.memory === 'string') {
        const memoryCheckpoint = JSON.parse(checkpoint.channel_values.memory) as MemoryCheckpoint
        if (Array.isArray(memoryCheckpoint.messages)) {
          return {
            ...state,
            messages: [...memoryCheckpoint.messages.slice(-contextWindow), ...state.messages],
          }
        }
      }

      return state
    } catch (error) {
      logger.error('Error loading from memory', { error })
      return state
    }
  }
)

/**
 * Creates a memory manager workflow using the Functional API
 */
export function createMemoryManager(memoryPersistence: MemorySaver, checkpoint_ns: string = 'default') {
  return entrypoint(
    {
      checkpointer: memoryPersistence,
      name: 'memory_manager',
    },
    async (state: MemoryState, config?: { configurable?: MemoryConfig }): Promise<MemoryState> => {
      try {
        // Load existing messages
        let currentState = await loadFromMemory(state, memoryPersistence, checkpoint_ns, config)

        // Clean up old messages
        currentState = await cleanupMemory(currentState, config)

        // Save updated state
        currentState = await saveToMemory(currentState, memoryPersistence, checkpoint_ns, config)

        return currentState
      } catch (error) {
        logger.error('Error in memory manager', { error })
        return {
          ...state,
          messages: state.messages || [],
          relevantHistory: [],
        }
      }
    }
  )
}

export class MemoryManager {
  private memory: Map<string, any>
  private messageHistory: BaseMessage[]

  constructor() {
    this.memory = new Map()
    this.messageHistory = []
  }

  addMessage(message: BaseMessage) {
    this.messageHistory.push(message)
  }

  getMessages(): BaseMessage[] {
    return [...this.messageHistory]
  }

  set(key: string, value: any) {
    this.memory.set(key, value)
  }

  get(key: string): any {
    return this.memory.get(key)
  }

  clear() {
    this.memory.clear()
    this.messageHistory = []
  }

  getState(): Record<string, any> {
    const state: Record<string, any> = {}
    for (const [key, value] of this.memory.entries()) {
      state[key] = value
    }
    return state
  }

  loadState(state: Record<string, any>) {
    this.memory.clear()
    for (const [key, value] of Object.entries(state)) {
      this.memory.set(key, value)
    }
  }
}
