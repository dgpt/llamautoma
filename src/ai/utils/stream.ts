import { EventEmitter } from 'events'
import { logger } from '@/logger'
import { RunnableConfig } from '@langchain/core/runnables'
import {
  StreamEvent,
  ResponseEvent,
  ProgressEvent,
  ErrorEvent,
  CompleteEvent,
} from '@/types/stream'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { encode as msgpackEncode } from '@msgpack/msgpack'

/**
 * Stream handler for client-server communication
 * Handles compression and event emission for all streaming responses
 */
export class StreamHandler extends EventEmitter {
  private currentStatus: string | null = null
  private taskResponses: Map<string, Array<ResponseEvent>> = new Map()

  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * Compress and emit an event
   */
  private emitCompressed(event: StreamEvent) {
    try {
      const compressed = msgpackEncode(event)
      this.emit('data', compressed)
    } catch (error) {
      logger.error('Failed to compress event:', error)
      // Fallback to uncompressed if compression fails
      this.emit('data', event)
    }
  }

  /**
   * Send a response to be shown in the chat window
   */
  sendResponse(task: string, content: string, metadata?: Record<string, any>) {
    const event: ResponseEvent = {
      type: 'response',
      task,
      content,
      metadata,
      timestamp: Date.now(),
    }

    // Store response for task
    if (!this.taskResponses.has(task)) {
      this.taskResponses.set(task, [])
    }
    this.taskResponses.get(task)?.push(event)

    // Compress and emit
    this.emitCompressed(event)
  }

  /**
   * Update progress status (shown at bottom of chat)
   */
  updateProgress(task: string, status: string) {
    // Only emit if status changed
    if (status === this.currentStatus) return
    this.currentStatus = status

    const event: ProgressEvent = {
      type: 'progress',
      task,
      status,
      timestamp: Date.now(),
    }

    // Compress and emit
    this.emitCompressed(event)
  }

  /**
   * Send an error event
   */
  sendError(task: string, error: string | Error) {
    const event: ErrorEvent = {
      type: 'error',
      task,
      error: error instanceof Error ? error.message : error,
      timestamp: Date.now(),
    }

    // Compress and emit
    this.emitCompressed(event)
  }

  /**
   * Send a completion event
   */
  sendComplete(task: string, finalStatus?: string) {
    const event: CompleteEvent = {
      type: 'complete',
      task,
      final_status: finalStatus,
      responses: Array.from(this.taskResponses.get(task) || []),
      timestamp: Date.now(),
    }

    // Clear task responses
    this.taskResponses.delete(task)
    this.currentStatus = null

    // Compress and emit
    this.emitCompressed(event)
  }
}

// Export singleton instance
export const streamHandler = new StreamHandler()

/**
 * Helper function to emit stream events from tasks
 */
export function emitStreamEvent(event: StreamEvent, config?: RunnableConfig) {
  if (config?.callbacks) {
    const handlers = Array.isArray(config.callbacks) ? config.callbacks : [config.callbacks]

    for (const callback of handlers) {
      if (callback instanceof StreamHandler) {
        callback.emit('data', msgpackEncode(event))
      }
    }
  }
}

/**
 * Updates the progress status in the chat window
 */
export function updateProgress(task: string, status: string, config?: RunnableConfig) {
  streamHandler.updateProgress(task, status)
  emitStreamEvent(
    {
      type: 'progress',
      task,
      status,
      timestamp: Date.now(),
    },
    config
  )
}

/**
 * Sends a task response to be displayed in the chat window
 */
export function sendTaskResponse(task: string, content: string, config?: RunnableConfig) {
  streamHandler.sendResponse(task, content)
  emitStreamEvent(
    {
      type: 'response',
      task,
      content,
      timestamp: Date.now(),
    },
    config
  )
}

/**
 * Sends a task completion event
 */
export function sendTaskComplete(task: string, finalStatus?: string, config?: RunnableConfig) {
  streamHandler.sendComplete(task, finalStatus)
  emitStreamEvent(
    {
      type: 'complete',
      task,
      final_status: finalStatus,
      timestamp: Date.now(),
    },
    config
  )
}

/**
 * Stream data to the client
 */
export async function streamToClient(data: unknown): Promise<void> {
  try {
    const message = {
      type: 'request',
      data,
    }

    // Log outgoing request
    logger.debug({ message }, 'Streaming request to client')

    // Emit to client
    stream.emit('data', JSON.stringify(message))
  } catch (error) {
    logger.error({ error }, 'Failed to stream request to client')
    throw error
  }
}

/**
 * Wait for client response
 */
export async function waitForClientResponse<T>(): Promise<T | null> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      cleanup()
      logger.warn('Client response timeout')
      resolve(null)
    }, 30000) // 30 second timeout

    const onResponse = (data: string) => {
      try {
        const response = JSON.parse(data)
        cleanup()
        logger.debug({ response }, 'Received client response')
        resolve(response as T)
      } catch (error) {
        logger.error({ error, data }, 'Failed to parse client response')
        cleanup()
        resolve(null)
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      stream.off('data', onResponse)
    }

    stream.once('data', onResponse)
  })
}
