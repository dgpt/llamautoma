import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import type { StreamEvent } from '@/types/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { mock } from 'bun:test'
import type { ServerMessage } from '@/stream'

// Mock file system for tests
const mockFiles = new Map<string, string>()

/**
 * Mock stream handler for tests
 */
export class MockStreamHandler extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * Decode a stream event
   */
  decodeEvent(data: Buffer | string): any {
    const text = typeof data === 'string' ? data : data.toString()
    if (!text.startsWith('data: ')) return {}
    try {
      return decodeAndDecompressMessage(text.slice(6))
    } catch (error) {
      logger.error('Failed to decode event:', error)
      return {}
    }
  }

  /**
   * Mock file content for tests
   */
  mockFile(path: string, content: string): void {
    mockFiles.set(path, content)
  }

  /**
   * Get mock file content
   */
  getFile(path: string): string | undefined {
    return mockFiles.get(path)
  }

  /**
   * Clear mock file system
   */
  clearMocks(): void {
    mockFiles.clear()
    this.removeAllListeners()
  }

  /**
   * Create mock response stream
   */
  createMockResponse(event: StreamEvent): ReadableStream {
    const encoder = new TextEncoder()

    return new ReadableStream({
      start(controller) {
        try {
          // Emit file chunk response
          const message: ServerMessage = {
            type: 'edit',
            content: JSON.stringify(event),
            timestamp: Date.now(),
          }
          const compressed = compressAndEncodeMessage(message)
          controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))

          // Emit completion event
          const complete: ServerMessage = {
            type: 'status',
            content: 'Complete',
            timestamp: Date.now(),
          }
          const compressedComplete = compressAndEncodeMessage(complete)
          controller.enqueue(encoder.encode(`data: ${compressedComplete}\n\n`))
          controller.close()
        } catch (error) {
          logger.error('Error creating mock response:', error)
          controller.error(error)
        }
      },
    })
  }

  /**
   * Emit a compressed event
   */
  emitCompressed(event: StreamEvent): void {
    logger.debug(`Mock stream emitting event: ${JSON.stringify(event)}`)
    const stream = this.createMockResponse(event)
    const reader = stream.getReader()

    // Read and emit stream data
    const readChunk = async () => {
      try {
        const { value, done } = await reader.read()
        if (done) {
          reader.releaseLock()
          return
        }
        this.emit('data', new Uint8Array(value))
        await readChunk()
      } catch (error) {
        reader.releaseLock()
        logger.error('Error reading mock stream:', error)
      }
    }

    readChunk().catch(error => {
      logger.error('Error in mock stream:', error)
    })
  }
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()

/**
 * Set up test mode with mocked stream functionality
 */
export function setTestMode(): void {
  // Clear any previous mocks
  mockFiles.clear()
  mockStream.removeAllListeners()

  // Mock the stream module
  mock.module('@/stream', () => ({
    createServerResponse: (messages: AsyncIterable<ServerMessage>) => {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          try {
            for await (const message of messages) {
              const compressed = compressAndEncodeMessage(message)
              controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
            }
          } catch (error) {
            logger.error('Error in mock stream:', error)
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
    },
    readClientStream: async function* (reader: ReadableStreamDefaultReader<Uint8Array>) {
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value)
          const messages = buffer.split('\n\n')
          buffer = messages.pop() || ''

          for (const message of messages) {
            if (!message.startsWith('data: ')) continue
            try {
              yield decodeAndDecompressMessage(message.slice(6))
            } catch (error) {
              logger.error('Stream decoding error:', error)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    },
  }))
}

export function resetTestMode(): void {
  mockStream.clearMocks()
  mock.restore()
}
