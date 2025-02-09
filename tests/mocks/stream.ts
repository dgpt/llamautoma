import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import type { StreamEvent } from '@/types/stream'
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
   * Mock a glob error for directory operations
   */
  mockGlobError(path: string, error: Error): void {
    // Store the error with a special prefix to distinguish from regular files
    mockFiles.set(`glob:${path}`, error.message)
  }

  /**
   * Create mock response stream
   */
  createMockResponse(event: StreamEvent): ReadableStream {
    const encoder = new TextEncoder()
    let path: string
    let fileContent: string | undefined

    if (event.type === 'response' && event.content) {
      const content = JSON.parse(event.content)
      if (content.type === 'file_request') {
        // Handle file request
        const { paths } = content.data
        path = paths[0]
        fileContent = mockFiles.get(path)

        // Create file chunk response
        const response: StreamEvent = {
          type: 'response',
          task: 'file',
          content: JSON.stringify({
            type: 'file_chunk',
            data: {
              path,
              content: fileContent,
              done: true,
            },
          }),
          timestamp: Date.now(),
        }

        return new ReadableStream({
          start(controller) {
            // Emit file chunk response
            const compressed = compressAndEncodeMessage(response)
            controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))

            // Emit completion event
            const complete: StreamEvent = {
              type: 'complete',
              task: 'file',
              timestamp: Date.now(),
            }
            const compressedComplete = compressAndEncodeMessage(complete)
            controller.enqueue(encoder.encode(`data: ${compressedComplete}\n\n`))
            controller.close()
          },
        })
      } else {
        // Handle other response types
        path = content.path
        fileContent = mockFiles.get(path)

        return new ReadableStream({
          start(controller) {
            // Create response event
            const response: StreamEvent = {
              type: 'response',
              task: 'file',
              content: fileContent
                ? JSON.stringify({ content: fileContent, path })
                : JSON.stringify({ error: `File not found: ${path}`, path }),
              timestamp: Date.now(),
            }

            // Emit compressed response
            const compressed = compressAndEncodeMessage(response)
            controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
            controller.close()
          },
        })
      }
    } else {
      throw new Error('Invalid event type or missing content')
    }
  }

  /**
   * Emit a compressed event
   */
  emitCompressed(event: StreamEvent): void {
    logger.debug(`Mock stream emitting event: ${JSON.stringify(event)}`)
    if (event.type === 'response') {
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
    createStreamResponse: (messages: AsyncIterable<StreamEvent>) => {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const message of messages) {
              if (message.type === 'response' && message.content) {
                const decoded = JSON.parse(message.content)
                if (decoded.type === 'run') {
                  // Handle command request
                  const response: StreamEvent = {
                    type: 'response',
                    task: 'command',
                    content: JSON.stringify({
                      type: 'command_chunk',
                      data: {
                        content: 'mock command output',
                        done: true,
                      },
                    }),
                    timestamp: Date.now(),
                  }
                  const compressed = compressAndEncodeMessage(response)
                  controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))

                  // Send completion
                  const complete: StreamEvent = {
                    type: 'response',
                    task: 'command',
                    content: JSON.stringify({
                      type: 'command_complete',
                      data: {
                        exitCode: 0,
                      },
                    }),
                    timestamp: Date.now(),
                  }
                  const compressedComplete = compressAndEncodeMessage(complete)
                  controller.enqueue(new TextEncoder().encode(`data: ${compressedComplete}\n\n`))
                } else if (decoded.type === 'file_request') {
                  const { paths } = decoded.data
                  for (const path of paths) {
                    const globError = mockFiles.get(`glob:${path}`)
                    const fileContent = mockFiles.get(path)

                    // Create response event
                    const response: StreamEvent = {
                      type: 'response',
                      task: 'file',
                      content: globError
                        ? JSON.stringify({ path, error: globError })
                        : fileContent
                          ? JSON.stringify({ path, content: fileContent })
                          : JSON.stringify({ path, error: `File not found: ${path}` }),
                      timestamp: Date.now(),
                    }

                    // Emit compressed response
                    const compressed = compressAndEncodeMessage(response)
                    controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
                  }
                }
              } else if (message.content && JSON.parse(message.content).type === 'run') {
                // Handle direct run command
                const response: StreamEvent = {
                  type: 'response',
                  task: 'command',
                  content: JSON.stringify({
                    type: 'command_chunk',
                    data: {
                      content: 'mock command output',
                      done: true,
                    },
                  }),
                  timestamp: Date.now(),
                }
                const compressed = compressAndEncodeMessage(response)
                controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))

                // Send completion
                const complete: StreamEvent = {
                  type: 'response',
                  task: 'command',
                  content: JSON.stringify({
                    type: 'command_complete',
                    data: {
                      exitCode: 0,
                    },
                  }),
                  timestamp: Date.now(),
                }
                const compressedComplete = compressAndEncodeMessage(complete)
                controller.enqueue(new TextEncoder().encode(`data: ${compressedComplete}\n\n`))
              }
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
  mockFiles.clear()
  mock.restore()
}
