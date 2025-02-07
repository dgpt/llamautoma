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

/**
 * Stream handler for client-server communication
 */
export class StreamHandler extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
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
    this.emit('data', JSON.stringify(event))
  }

  /**
   * Update progress status (shown at bottom of chat)
   */
  updateProgress(task: string, status: string) {
    const event: ProgressEvent = {
      type: 'progress',
      task,
      status,
      timestamp: Date.now(),
    }
    this.emit('data', JSON.stringify(event))
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
    this.emit('data', JSON.stringify(event))
  }

  /**
   * Send a completion event
   */
  sendComplete(task: string, finalStatus?: string) {
    const event: CompleteEvent = {
      type: 'complete',
      task,
      final_status: finalStatus,
      timestamp: Date.now(),
    }
    this.emit('data', JSON.stringify(event))
  }
}

// Export singleton instance
export const stream = new StreamHandler()

/**
 * Helper to update progress from tasks
 */
export function updateProgress(task: string, status: string, config?: RunnableConfig) {
  stream.updateProgress(task, status)
}

/**
 * Helper to send response from tasks
 */
export function sendTaskResponse(task: string, content: string, metadata?: Record<string, any>) {
  stream.sendResponse(task, content, metadata)
}

/**
 * Helper to send error from tasks
 */
export function sendTaskError(task: string, error: string | Error) {
  stream.sendError(task, error)
}

/**
 * Helper to send completion from tasks
 */
export function sendTaskComplete(task: string, finalStatus?: string) {
  stream.sendComplete(task, finalStatus)
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

/**
 * Helper function to emit stream events from tasks
 */
function emitStreamEvent(event: StreamEvent, config?: RunnableConfig) {
  if (config?.callbacks) {
    const handlers = Array.isArray(config.callbacks)
      ? config.callbacks
      : config.callbacks.handlers || []

    const eventText = JSON.stringify(event)
    for (const handler of handlers) {
      if (handler instanceof BaseCallbackHandler && handler.handleLLMNewToken) {
        handler.handleLLMNewToken(
          eventText,
          { prompt: 0, completion: 1 },
          config.runName || 'default',
          undefined,
          ['stream']
        )
      }
    }
  }
}

/**
 * Emits a response that should be appended to the conversation
 */
export function emitResponse(task: string, content: string, config?: RunnableConfig) {
  emitStreamEvent(
    {
      type: 'response',
      task,
      content,
    },
    config
  )
}

/**
 * Emits an error message
 */
export function emitError(task: string, error: string, config?: RunnableConfig) {
  emitStreamEvent(
    {
      type: 'error',
      task,
      error,
    },
    config
  )
}

/**
 * Signals task completion, optionally with a final status message
 */
export function emitComplete(task: string, config?: RunnableConfig, final_status?: string) {
  emitStreamEvent(
    {
      type: 'complete',
      task,
      final_status,
    },
    config
  )
}
