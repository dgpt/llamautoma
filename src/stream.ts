import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'
import type {
  ServerToClientMessage as ServerMessage,
  ClientToServerMessage as ClientMessage,
} from '@/types/stream'

// Re-export types
export type { ServerToClientMessage, ClientToServerMessage } from '@/types/stream'

/**
 * Create a message stream for bidirectional communication
 */
function createMessageStream() {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Message handlers
  const outboundHandlers = new Set<(message: string) => void>()
  const inboundHandlers = new Set<(message: ClientMessage) => void>()

  // Active listeners
  const activeListeners = new Map<
    string,
    {
      reader: ReadableStreamDefaultReader<Uint8Array>
      buffer: string
    }
  >()

  // Response stream controllers
  const responseControllers = new Set<ReadableStreamController<Uint8Array>>()

  /**
   * Process incoming messages from a buffer
   */
  function processMessages(messages: string[]): void {
    for (const message of messages) {
      if (!message.startsWith('data: ')) continue
      try {
        const decoded = decodeAndDecompressMessage(message.slice(6))
        for (const handler of inboundHandlers) {
          try {
            handler(decoded)
          } catch (error) {
            logger.error('Inbound handler error:', error)
          }
        }
      } catch (error) {
        logger.error('Stream decoding error:', error)
      }
    }
  }

  /**
   * Start listening to a stream
   */
  async function startListening(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    listenerId: string
  ): Promise<void> {
    const listener = {
      reader,
      buffer: '',
    }
    activeListeners.set(listenerId, listener)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        listener.buffer += decoder.decode(value)
        const messages = listener.buffer.split('\n\n')
        listener.buffer = messages.pop() || ''

        processMessages(messages)
      }
    } catch (error) {
      logger.error('Stream error:', error)
    } finally {
      reader.releaseLock()
      activeListeners.delete(listenerId)
    }
  }

  return {
    /**
     * Listen for client messages
     */
    listen(reader: ReadableStreamDefaultReader<Uint8Array>): string {
      const listenerId = Bun.randomUUIDv7()
      startListening(reader, listenerId).catch(error => {
        logger.error('Error in stream listener:', error)
      })
      return listenerId
    },

    /**
     * Stop a specific listener
     */
    async stopListener(listenerId: string): Promise<void> {
      const listener = activeListeners.get(listenerId)
      if (listener) {
        try {
          await listener.reader.cancel()
        } catch (error) {
          logger.error('Error stopping listener:', error)
        } finally {
          activeListeners.delete(listenerId)
        }
      }
    },

    /**
     * Stop all listeners
     */
    async stopAllListeners(): Promise<void> {
      const promises = Array.from(activeListeners.entries()).map(([id]) => this.stopListener(id))
      await Promise.all(promises)
    },

    /**
     * Register outbound message handler
     */
    onOutboundMessage(handler: (message: string) => void): () => void {
      outboundHandlers.add(handler)
      return () => outboundHandlers.delete(handler)
    },

    /**
     * Register inbound message handler
     */
    onInboundMessage(handler: (message: ClientMessage) => void): () => void {
      inboundHandlers.add(handler)
      return () => inboundHandlers.delete(handler)
    },

    /**
     * Broadcast a message to all outbound handlers
     */
    broadcast(message: string): void {
      for (const handler of outboundHandlers) {
        try {
          handler(message)
        } catch (error) {
          logger.error('Outbound handler error:', error)
        }
      }
    },

    /**
     * Create a server response stream
     */
    createResponseStream(): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          responseControllers.add(controller)
        },
        cancel(controller) {
          responseControllers.delete(controller)
        },
      })
    },

    /**
     * Write data to all response streams
     */
    write(data: string): void {
      const encoded = encoder.encode(data)
      for (const controller of responseControllers) {
        try {
          controller.enqueue(encoded)
        } catch (error) {
          logger.error('Write error:', error)
          responseControllers.delete(controller)
        }
      }
    },
  }
}

// Create singleton instance
const messageStream = createMessageStream()

/**
 * Listen for client messages
 */
export function listen(reader: ReadableStreamDefaultReader<Uint8Array>): string {
  return messageStream.listen(reader)
}

/**
 * Stop a specific listener
 */
export function stopListener(listenerId: string): Promise<void> {
  return messageStream.stopListener(listenerId)
}

/**
 * Stop all listeners
 */
export function stopListening(): Promise<void> {
  return messageStream.stopAllListeners()
}

/**
 * Create a server response stream
 */
export function createResponseStream(): ReadableStream<Uint8Array> {
  return messageStream.createResponseStream()
}

/**
 * Write data to all response streams
 */
export function write(data: string): void {
  messageStream.write(data)
}

/**
 * Broadcast a message to all outbound handlers
 */
export function broadcast(messages: AsyncIterable<ServerMessage>): void {
  const compressed = compressAndEncodeMessage(messages)
  messageStream.broadcast(compressed)
}

/**
 * Broadcast a progress update
 */
export function broadcastProgress(content: string): void {
  const message: ServerMessage = {
    type: 'progress',
    content,
    timestamp: Date.now(),
  }
  broadcast(toAsyncIterable([message]))
}

/**
 * Broadcast a chat message
 */
export function broadcastMessage(content: string): void {
  const message: ServerMessage = {
    type: 'chat',
    content,
    timestamp: Date.now(),
  }
  broadcast(toAsyncIterable([message]))
}

/**
 * Convert array to async iterable
 */
function toAsyncIterable<T>(arr: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield* arr
    },
  }
}
