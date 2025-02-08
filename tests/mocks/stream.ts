import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import type { StreamMessage } from '@/stream'
import {
  compressAndEncodeFile,
  compressAndEncodeMessage,
  decodeAndDecompressMessage,
} from '@/lib/compression'
import { mock } from 'bun:test'

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
   * Mock a glob error for directory operations
   */
  mockGlobError(path: string, error: Error): void {
    // Store the error with a special prefix to distinguish from regular files
    mockFiles.set(`glob:${path}`, error.message)
  }

  /**
   * Create mock response stream
   */
  createMockResponse(event: StreamMessage): ReadableStream {
    const encoder = new TextEncoder()
    const { path } = event.data as { path: string; action: string }
    const content = mockFiles.get(path)

    return new ReadableStream({
      start(controller) {
        // Create response event
        const response: StreamMessage = {
          type: 'edit',
          data: content ? { content, path } : { error: `File not found: ${path}`, path },
        }

        // Emit compressed response
        const compressed = compressAndEncodeMessage(response)
        controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
        controller.close()
      },
    })
  }

  /**
   * Emit a compressed event
   */
  emitCompressed(event: StreamMessage): void {
    logger.debug(`Mock stream emitting event: ${JSON.stringify(event)}`)
    if (event.type === 'edit') {
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
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()

// Export test mode functions
export function setTestMode(): void {
  // Clear any previous mocks
  mockFiles.clear()

  // Mock stream functions
  mock.module('@/stream', () => ({
    createStreamResponse: (messages: AsyncIterable<StreamMessage>) => {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const message of messages) {
              const { path, action } = message.data as { path: string; action: string }
              const content = mockFiles.get(path)
              const globError = mockFiles.get(`glob:${path}`)

              // Create response event
              const response: StreamMessage = {
                type: 'edit',
                data: globError
                  ? { path, error: globError }
                  : content
                    ? { path, content }
                    : { path, error: `File not found: ${path}` },
              }

              // Emit compressed response
              const compressed = compressAndEncodeMessage(response)
              controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
            }
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

  // Mock glob function
  mock.module('glob', () => ({
    glob: async (pattern: string, options: any) => {
      const basePath = pattern.split('/*')[0]
      const globError = mockFiles.get(`glob:${basePath}`)
      if (globError) {
        throw new Error(globError)
      }
      return []
    },
  }))

  // Mock streamHandler
  mock.module('@/ai/utils/stream', () => ({
    streamHandler: {
      emitCompressed: mockStream.emitCompressed.bind(mockStream),
      on: mockStream.on.bind(mockStream),
      off: mockStream.off.bind(mockStream),
      emit: mockStream.emit.bind(mockStream),
    },
  }))
}

export function resetTestMode(): void {
  mockStream.clearMocks()
  mock.restore()
}
