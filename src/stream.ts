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
  const activeListeners = new Set<string>()

  // Track processed messages to prevent duplicates
  const processedMessages = new Set<string>()

  // Create shared stream
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const reader = readable.getReader()

  /**
   * Process incoming messages from a buffer
   */
  function processMessages(messages: string[]): void {
    for (const message of messages) {
      if (!message.startsWith('data: ')) continue

      // Skip if message already processed
      if (processedMessages.has(message)) continue
      processedMessages.add(message)

      // Validate message format
      const messageContent = message.slice(6).trim()

      const decoded = decodeAndDecompressMessage(messageContent)
      // Process each message in the array
      for (const msg of decoded) {
        if (!msg || typeof msg !== 'object' || !('type' in msg) || !('content' in msg)) {
          logger.error('Invalid message structure:', msg)
          return // Stop processing all messages on invalid structure
        }

        // Validate message type and content
        if (typeof msg.type !== 'string' || typeof msg.content !== 'string') {
          logger.error('Invalid message type or content:', msg)
          return // Stop processing all messages on invalid type/content
        }

        // Convert server message to client message
        const clientMessage: ClientMessage = {
          type: 'input',
          data: msg.content,
          timestamp: msg.timestamp,
        }

        for (const handler of inboundHandlers) {
          try {
            handler(clientMessage)
          } catch (error) {
            logger.error('Inbound handler error:', error)
          }
        }
      }
    }
  }

  /**
   * Write data to stream
   */
  async function write(data: string): Promise<void> {
    const formattedData = data.startsWith('data: ') ? data : `data: ${data}\n\n`
    await writer.write(encoder.encode(formattedData))
  }

  /**
   * Start listening to stream
   */
  async function startListening(listenerId: string): Promise<void> {
    let buffer = ''
    activeListeners.add(listenerId)

    while (activeListeners.has(listenerId)) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value)
      const messages = buffer.split('\n\n')
      buffer = messages.pop() || ''

      processMessages(messages)
    }
    activeListeners.delete(listenerId)
  }

  return {
    /**
     * Listen for client messages
     */
    listen(): string {
      const listenerId = Bun.randomUUIDv7()
      startListening(listenerId).catch(error => {
        logger.error('Error in stream listener:', error)
      })
      return listenerId
    },

    /**
     * Stop a specific listener
     */
    async stopListener(listenerId: string): Promise<void> {
      activeListeners.delete(listenerId)
    },

    /**
     * Stop all listeners
     */
    async stopAllListeners(): Promise<void> {
      activeListeners.clear()
      processedMessages.clear()
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
     * Broadcast a message to all outbound handlers and streams
     */
    async broadcast(
      message: ServerMessage | ServerMessage[] | AsyncIterable<ServerMessage>
    ): Promise<void> {
      try {
        const messages = Array.isArray(message)
          ? message
          : Symbol.asyncIterator in message
            ? [...(await toArray(message))]
            : [message]

        const compressed = compressAndEncodeMessage(messages)
        await write(compressed)

        // Notify outbound handlers
        for (const handler of outboundHandlers) {
          try {
            handler(compressed)
          } catch (error) {
            logger.error('Outbound handler error:', error)
          }
        }
      } catch (error) {
        logger.error('Broadcast error:', error)
      }
    },
  }
}

// Create singleton instance
const messageStream = createMessageStream()

// Export singleton methods with broadcast wrapper for string messages
export const {
  listen,
  stopListener,
  stopAllListeners: stopListening,
  onOutboundMessage,
  onInboundMessage,
} = messageStream

// Export broadcast with string message support
export function broadcast(
  message: ServerMessage | ServerMessage[] | AsyncIterable<ServerMessage> | string,
  type?: 'chat' | 'progress'
): Promise<void> {
  // If type is provided, wrap the message in the appropriate type
  if (typeof message === 'string' && type) {
    return messageStream.broadcast({
      type,
      content: message,
      timestamp: Date.now(),
    })
  }
  return messageStream.broadcast(
    message as ServerMessage | ServerMessage[] | AsyncIterable<ServerMessage>
  )
}

// Helper functions
async function toArray<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) {
    result.push(item)
  }
  return result
}
