import { EventEmitter } from 'node:events'
import { StreamEvent } from '@/types/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'

/**
 * Stream handler for client-server communication
 * Handles compression and event emission for all streaming responses
 */
export class Stream extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(Infinity)
  }

  /**
   * Compress and emit an event
   */
  emit(event: StreamEvent): boolean // Overload signature
  emit(eventName: string | symbol, ...args: unknown[]): boolean // Original signature
  emit(event: StreamEvent | string | symbol, ...args: unknown[]): boolean {
    // Implementation signature
    if (typeof event === 'string' || typeof event === 'symbol') {
      return super.emit(event, ...args)
    }

    return super.emit(
      'data',
      compressAndEncodeMessage({
        ...event,
        timestamp: Date.now(),
      })
    )
  }

  /**
   * Create a streaming response with proper headers
   */
  createResponse(threadId: string): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${compressAndEncodeMessage({
              event: 'start',
              threadId,
              timestamp: Date.now(),
            })}\n\n`
          )
        )
      },
      cancel() {
        logger.debug('Stream cancelled')
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
   * Send a streaming response to the client
   */
  async *streamToClient<T>(data: AsyncIterable<T>): AsyncGenerator<string> {
    for await (const chunk of data) {
      yield compressAndEncodeMessage({
        event: 'content',
        data: chunk,
        timestamp: Date.now(),
      })
    }

    yield compressAndEncodeMessage({
      event: 'end',
      timestamp: Date.now(),
    })
  }

  /**
   * Read a streaming response from the client
   */
  async *readFromClient(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<any> {
    let partialLine = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = new TextDecoder().decode(value)
        const lines = (partialLine + text).split('\n')
        partialLine = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

          try {
            const data = decodeAndDecompressMessage(trimmedLine.slice(6))
            if (data?.data?.content) {
              yield data
            }
          } catch (error) {
            logger.error('Error parsing stream data:', error)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

// Export singleton instance
export const stream = new Stream()
export default stream
