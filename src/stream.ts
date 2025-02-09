import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'
import type { ServerToClientMessage, ClientToServerMessage } from '@/types/stream'

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
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const message = decodeAndDecompressMessage(data)
            yield message as ClientToServerMessage
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
 * Internal stream manager for handling broadcast
 */
class StreamManager {
  private handlers: ((message: ServerToClientMessage) => void)[] = []

  broadcast(message: ServerToClientMessage): void {
    for (const handler of this.handlers) {
      try {
        handler(message)
      } catch (error) {
        logger.error('Stream handler error:', error)
      }
    }
  }

  onMessage(handler: (message: ServerToClientMessage) => void): void {
    this.handlers.push(handler)
  }

  offMessage(handler: (message: ServerToClientMessage) => void): void {
    this.handlers = this.handlers.filter(h => h !== handler)
  }
}

// Internal singleton instance
const streamManager = new StreamManager()

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

/**
 * Create a server-sent events (SSE) stream for sending messages from server to client
 */
export const createServerResponse = (messages: AsyncIterable<ServerToClientMessage>): Response => {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const message of messages) {
          const compressed = compressAndEncodeMessage(message)
          controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
        }
      } catch (error) {
        logger.error('Server stream encoding error:', error)
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