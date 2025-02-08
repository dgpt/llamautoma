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

  /**
   * Create a transform stream for handling SSE data
   */
  private createTransformStream(encoder: TextEncoder): TransformStream<string, Uint8Array> {
    return new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
      },
    })
  }

  /**
   * Create a streaming response handler
   * This abstracts the common logic for handling streaming responses
   */
  createStreamHandler<T>(generator: AsyncIterable<T>, onError?: (error: Error) => void): Response {
    const encoder = new TextEncoder()
    const transformStream = this.createTransformStream(encoder)
    const { readable, writable } = transformStream

    // Create response with initial headers
    const response = new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })

    // Start streaming
    const writer = writable.getWriter()
    this.pipeToWriter(writer, generator, onError)

    return response
  }

  /**
   * Pipe an async generator to a writer with error handling
   */
  private async pipeToWriter<T>(
    writer: WritableStreamDefaultWriter<string>,
    generator: AsyncIterable<T>,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      // Write start event
      await writer.write(
        compressAndEncodeMessage({
          event: 'start',
          timestamp: Date.now(),
        })
      )

      // Stream the data
      for await (const chunk of this.streamToClient(generator)) {
        await writer.write(chunk)
      }
    } catch (error) {
      logger.error('Stream error:', error)
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      await writer.close()
    }
  }
}

// Export singleton instance
export const stream = new Stream()
export default stream
