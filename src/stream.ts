import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'
import {
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
  const inboundHandlers = new Map<string, (message: ClientMessage) => void>()

  // Create shared stream
  let stream = new TransformStream<Uint8Array, Uint8Array>()
  let writer: WritableStreamDefaultWriter<Uint8Array>
  let reader: ReadableStreamDefaultReader<Uint8Array>

  function initializeStream() {
    stream = new TransformStream<Uint8Array, Uint8Array>()
    writer = stream.writable.getWriter()
    reader = stream.readable.getReader()
  }

  // Initialize stream
  initializeStream()

  // Track if we should continue listening
  let isListening = false

  /**
   * Process incoming messages from a buffer
   */
  function processMessages(messages: string[]): void {
    if (!isListening) return // Don't process messages if not listening

    for (const message of messages) {
      if (!message.startsWith('data: ')) continue

      // Validate message format
      const messageContent = message.slice(6).trim()

      try {
        const decoded = decodeAndDecompressMessage(messageContent)
        // Process each message in the array
        for (const msg of decoded) {
          // Convert server message to client message
          const clientMessage: ClientMessage = {
            type: 'input',
            data: msg.content ?? msg.data ?? '', // Ensure empty string for empty content
            timestamp: msg.timestamp || Date.now(),
          }

          // Call all handlers with the message
          for (const handler of inboundHandlers.values()) {
            handler(clientMessage)
          }
        }
      } catch (error) {
        logger.error('Failed to decode message:', error)
      }
    }
  }

  /**
   * Write data to stream
   */
  async function write(data: string): Promise<void> {
    if (!isListening) return // Don't write if not listening
    const formattedData = data.startsWith('data: ') ? data : `data: ${data}\n\n`
    await writer.write(encoder.encode(formattedData))
  }

  /**
   * Start listening to stream
   */
  async function startListening(): Promise<void> {
    if (isListening) return
    isListening = true
    let buffer = ''

    try {
      while (isListening && inboundHandlers.size > 0) {
        try {
          const result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Stream read timeout')), 500)
            ),
          ])

          if (result.done) break

          buffer += decoder.decode(result.value)
          const messages = buffer.split('\n\n')
          buffer = messages.pop() || ''

          processMessages(messages)
        } catch (error) {
          // Handle stream read timeout by resetting and continuing
          if (error instanceof Error && error.message === 'Stream read timeout') {
            logger.debug('Stream read timeout - resetting stream')
            await resetStream()
            isListening = true
            continue
          }
          // Any other error means we should stop listening
          break
        }
      }
    } finally {
      isListening = false
    }
  }

  /**
   * Reset the stream
   */
  async function resetStream() {
    isListening = false

    // Close existing streams - errors are expected and can be ignored
    try {
      await writer.close()
    } catch {}
    try {
      await reader.cancel()
    } catch {}

    // Create new stream
    initializeStream()
  }

  // Start listening when first handler is added
  let listeningPromise: Promise<void> | null = null

  return {
    /**
     * Register a handler for inbound messages
     * Returns a cleanup function to remove the handler
     */
    onInboundMessage(handler: (message: ClientMessage) => void): () => void {
      const handlerId = Bun.randomUUIDv7()
      inboundHandlers.set(handlerId, handler)

      // Start listening if this is the first handler
      if (!listeningPromise && !isListening) {
        listeningPromise = startListening()
      }

      // Return cleanup function
      return () => {
        inboundHandlers.delete(handlerId)
      }
    },

    /**
     * Register a handler for outbound messages
     * Returns a cleanup function to remove the handler
     */
    onOutboundMessage(handler: (message: string) => void): () => void {
      outboundHandlers.add(handler)
      return () => outboundHandlers.delete(handler)
    },

    /**
     * Stop all handlers and clean up resources
     */
    stopAllHandlers(): Promise<void> {
      // Synchronously clear all handlers and state
      isListening = false
      inboundHandlers.clear()
      outboundHandlers.clear()
      listeningPromise = null

      // Synchronously reset stream
      try {
        writer.close()
        reader.cancel()
      } catch (error) {
        logger.error('Error closing stream:', error)
      }

      // Create new stream immediately
      initializeStream()

      // Return resolved promise since cleanup is done
      return Promise.resolve()
    },

    async broadcast(message: ServerMessage | ServerMessage[]): Promise<void> {
      if (!isListening) return // Don't broadcast if not listening

      try {
        const messages = Array.isArray(message) ? message : [message]
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

// Export singleton methods
export const { onInboundMessage, onOutboundMessage, stopAllHandlers } = messageStream

// Export broadcast with proper message handling
export function broadcast(
  message: ServerMessage | ServerMessage[] | string,
  type: ServerMessage['type'] = 'chat'
): Promise<void> {
  // If string message, wrap it in a proper ServerMessage
  if (typeof message === 'string') {
    return messageStream.broadcast({
      type,
      content: message,
      timestamp: Date.now(),
    })
  }

  // Add timestamps to all messages
  const messages = Array.isArray(message) ? message : [message]
  const timestampedMessages = messages.map(msg => ({
    ...msg,
    timestamp: msg.timestamp || Date.now(),
  }))

  // Broadcast the timestamped messages
  return messageStream.broadcast(timestampedMessages)
}