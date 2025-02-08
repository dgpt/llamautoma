import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import { StreamHandler } from '@/ai/utils/stream'
import type { FileInput } from 'llamautoma-types'
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
   * Emit a compressed event
   */
  emitCompressed(event: StreamEvent): void {
    logger.debug(`Mock stream emitting event: ${JSON.stringify(event)}`)
    if (event.type === 'response' && event.task === 'file') {
      const request = JSON.parse(event.content)
      if (request.type === 'file_request') {
        // Handle file request
        for (const path of request.data.paths) {
          const content = mockFiles.get(path)
          if (content) {
            // Emit file chunk response
            const response: StreamEvent = {
              type: 'response',
              task: 'file',
              content: JSON.stringify({
                type: 'file_chunk',
                data: {
                  path,
                  content: content, // Don't compress in mock - let lib/file handle it
                  done: true,
                },
              }),
              timestamp: Date.now(),
            }
            // Emit compressed response
            const compressed = compressAndEncodeMessage(response)
            this.emit('data', compressed)
          } else {
            // Emit error for missing file
            const response: StreamEvent = {
              type: 'error',
              task: 'file',
              error: `File not found: ${path}`,
              timestamp: Date.now(),
            }
            // Emit compressed error
            const compressed = compressAndEncodeMessage(response)
            this.emit('data', compressed)
          }
        }
        // Emit completion
        const complete: StreamEvent = {
          type: 'complete',
          task: 'file',
          timestamp: Date.now(),
        }
        // Emit compressed completion
        const compressed = compressAndEncodeMessage(complete)
        this.emit('data', compressed)
      }
    }
  }
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()

// Export test mode functions
export function setTestMode(): void {
  // Clear any previous mocks
  mockFiles.clear()

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
