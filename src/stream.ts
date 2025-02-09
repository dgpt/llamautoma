import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'
import type {
  ServerToClientMessage as ServerMessage,
  ClientToServerMessage as ClientMessage,
} from '@/types/stream'

// Re-export types
export type ServerToClientMessage = ServerMessage
export type ClientToServerMessage = ClientMessage

/**
 * Create a server response with proper SSE headers
 */
export const createServerResponse = (messages: AsyncIterable<ServerToClientMessage>): Response => {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const message of messages) {
          const compressed = compressAndEncodeMessage(message)
          controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
        }
      } catch (error) {
        logger.error('Error in server stream:', error)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Listen for messages from client's inbound stream
 */
export const listen = async function* (
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ClientToServerMessage> {
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop() || ''

      for (const message of messages) {
        if (message.startsWith('data: ')) {
          const data = message.slice(6)
          try {
            const decoded = decodeAndDecompressMessage(data)
            yield decoded as ClientToServerMessage
          } catch (error) {
            logger.error('Client stream decoding error:', error)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Stream manager for handling message broadcasts
 */
export class StreamManager {
  private outboundHandlers: ((message: string) => void)[] = []
  private inboundHandlers: ((message: ClientToServerMessage) => void)[] = []
  private activeStreams: Map<string, ReadableStreamDefaultReader<Uint8Array>> = new Map()

  /**
   * Register outbound message handler
   */
  onOutboundMessage(handler: (message: string) => void): void {
    this.outboundHandlers.push(handler)
  }

  /**
   * Unregister outbound message handler
   */
  offOutboundMessage(handler: (message: string) => void): void {
    this.outboundHandlers = this.outboundHandlers.filter(h => h !== handler)
  }

  /**
   * Register inbound message handler
   */
  onInboundMessage(handler: (message: ClientToServerMessage) => void): void {
    this.inboundHandlers.push(handler)
  }

  /**
   * Unregister inbound message handler
   */
  offInboundMessage(handler: (message: ClientToServerMessage) => void): void {
    this.inboundHandlers = this.inboundHandlers.filter(h => h !== handler)
  }

  /**
   * Broadcast message to all outbound handlers
   */
  broadcast(message: ServerToClientMessage): void {
    const compressed = compressAndEncodeMessage(message)
    for (const handler of this.outboundHandlers) {
      try {
        handler(compressed)
      } catch (error) {
        logger.error('Stream handler error:', error)
      }
    }
  }

  /**
   * Start listening to an inbound stream
   */
  async startInboundStream(
    id: string,
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<void> {
    this.activeStreams.set(id, reader)
    try {
      for await (const message of listen(reader)) {
        for (const handler of this.inboundHandlers) {
          try {
            handler(message)
          } catch (error) {
            logger.error('Inbound handler error:', error)
          }
        }
      }
    } catch (error) {
      logger.error('Inbound stream error:', error)
    } finally {
      this.activeStreams.delete(id)
    }
  }

  /**
   * Stop a specific stream
   */
  async stopStream(id: string): Promise<void> {
    const reader = this.activeStreams.get(id)
    if (reader) {
      try {
        await reader.cancel()
      } catch (error) {
        logger.error('Error stopping stream:', error)
      } finally {
        this.activeStreams.delete(id)
      }
    }
  }

  /**
   * Stop all active streams
   */
  async stopAllStreams(): Promise<void> {
    const promises = Array.from(this.activeStreams.keys()).map(id => this.stopStream(id))
    await Promise.all(promises)
  }
}

// Export singleton instance
export const streamManager = new StreamManager()

/**
 * Send a message to all registered handlers
 */
export const broadcast = (message: ServerToClientMessage): void => {
  streamManager.broadcast(message)
}

/**
 * Send a chat message to be displayed in the user's chat window
 */
export const broadcastMessage = (content: string, metadata?: Record<string, unknown>): void => {
  broadcast({
    type: 'chat',
    content,
    timestamp: Date.now(),
    metadata,
  })
}

/**
 * Send a progress update to be displayed in the status area
 */
export const broadcastProgress = (content: string, metadata?: Record<string, unknown>): void => {
  broadcast({
    type: 'progress',
    content,
    timestamp: Date.now(),
    metadata,
  })
}