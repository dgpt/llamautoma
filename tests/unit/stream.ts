import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import { expect, test, describe, beforeEach } from 'bun:test'
import { Stream } from '@/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { StreamEvent } from '@/types/stream'

/**
 * Mock stream handler for tests
 */
export class MockStreamHandler extends EventEmitter {
  private mockFileSystem = new Map<string, string>()

  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * Mock streaming request to client
   */
  async streamToClient(request: any): Promise<void> {
    try {
      // Store request in mock file system
      this.mockFileSystem.set('lastRequest', JSON.stringify(request))

      // For file requests, emit mock file response
      if (request.type === 'file_request') {
        const { paths } = request.data
        for (const path of paths) {
          const content = this.mockFileSystem.get(path)
          if (content) {
            // Emit file chunk event
            this.emit(
              'data',
              JSON.stringify({
                type: 'file_chunk',
                data: {
                  path,
                  chunk: content,
                  done: true,
                },
              })
            )
          }
        }
      }

      // Always emit complete event
      this.emit(
        'data',
        JSON.stringify({
          type: 'file_complete',
        })
      )
    } catch (error) {
      logger.error({ error }, 'Mock stream error')
      throw error
    }
  }

  /**
   * Mock waiting for client response
   */
  async waitForClientResponse<T>(): Promise<T> {
    return new Promise(resolve => {
      // Get the last request
      const lastRequest = this.mockFileSystem.get('lastRequest')
      if (!lastRequest) {
        resolve({
          type: 'file_complete',
        } as T)
        return
      }

      try {
        const request = JSON.parse(lastRequest)
        if (request.type === 'file_request') {
          const { paths } = request.data
          const files: Record<string, { path: string; content: string }> = {}

          // Collect all requested files
          for (const path of paths) {
            const content = this.mockFileSystem.get(path)
            if (content) {
              files[path] = { path, content }
            }
          }

          // Return file chunk response
          if (Object.keys(files).length > 0) {
            resolve({
              type: 'file_chunk',
              data: {
                path: paths[0],
                chunk: files[paths[0]].content,
                done: true,
              },
            } as T)
          } else {
            resolve({
              type: 'file_complete',
            } as T)
          }
        } else {
          resolve({
            type: 'file_complete',
          } as T)
        }
      } catch (error) {
        logger.error({ error }, 'Failed to parse last request')
        resolve({
          type: 'file_complete',
        } as T)
      }
    })
  }

  /**
   * Mock file content for tests
   */
  mockFile(path: string, content: string): void {
    this.mockFileSystem.set(path, content)
  }

  /**
   * Clear mock file system
   */
  clearMocks(): void {
    this.mockFileSystem.clear()
  }
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()

describe('Stream', () => {
  let streamHandler: Stream

  beforeEach(() => {
    streamHandler = new Stream()
  })

  describe('Event Emission', () => {
    test('should compress and emit stream events', () => {
      const event: StreamEvent = {
        type: 'response',
        task: 'test',
        content: 'test content',
        timestamp: Date.now(),
      }

      let emitted = false
      streamHandler.on('data', (data: string) => {
        const decoded = decodeAndDecompressMessage(data)
        expect(decoded.type).toBe(event.type)
        expect(decoded.task).toBe(event.task)
        expect(decoded.timestamp).toBeNumber()
        emitted = true
      })

      streamHandler.emit(event)
      expect(emitted).toBe(true)
    })

    test('should handle regular event emission', () => {
      let emitted = false
      streamHandler.on('test', () => {
        emitted = true
      })

      streamHandler.emit('test')
      expect(emitted).toBe(true)
    })
  })

  describe('Response Creation', () => {
    test('should create streaming response with correct headers', () => {
      const response = streamHandler.createResponse('test-thread')
      expect(response).toBeInstanceOf(Response)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(response.headers.get('Connection')).toBe('keep-alive')
    })

    test('should include compressed start event in response', async () => {
      const response = streamHandler.createResponse('test-thread')
      const reader = response.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toStartWith('data: ')

      const data = decodeAndDecompressMessage(text.slice(6))
      expect(data.event).toBe('start')
      expect(data.threadId).toBe('test-thread')
      expect(data.timestamp).toBeNumber()
    })
  })

  describe('Client Streaming', () => {
    test('should stream data to client with compression', async () => {
      const data = [{ test: 1 }, { test: 2 }]
      const generator = async function* () {
        for (const item of data) {
          yield item
        }
      }

      const chunks: string[] = []
      for await (const chunk of streamHandler.streamToClient(generator())) {
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(3) // 2 data chunks + 1 end event

      const firstChunk = decodeAndDecompressMessage(chunks[0])
      expect(firstChunk.event).toBe('content')
      expect(firstChunk.data).toEqual(data[0])

      const lastChunk = decodeAndDecompressMessage(chunks[2])
      expect(lastChunk.event).toBe('end')
    })

    test('should read compressed data from client', async () => {
      const mockData = [
        compressAndEncodeMessage({ data: { content: 'test1' } }),
        compressAndEncodeMessage({ data: { content: 'test2' } }),
      ]

      const encoder = new TextEncoder()
      const mockStream = new ReadableStream({
        start(controller) {
          for (const data of mockData) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
          controller.close()
        },
      })

      const reader = mockStream.getReader()
      const results: any[] = []
      for await (const chunk of streamHandler.readFromClient(reader)) {
        results.push(chunk)
      }

      expect(results).toHaveLength(2)
      expect(results[0].data.content).toBe('test1')
      expect(results[1].data.content).toBe('test2')
    })

    test('should handle invalid data from client', async () => {
      const encoder = new TextEncoder()
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: invalid\n\n'))
          controller.close()
        },
      })

      const reader = mockStream.getReader()
      const results: any[] = []
      for await (const chunk of streamHandler.readFromClient(reader)) {
        results.push(chunk)
      }

      expect(results).toHaveLength(0)
    })
  })
})
