import { mock } from 'bun:test'
import * as streamModule from '@/stream'
import type { ClientToServerMessage } from '@/stream'
import { compressAndEncodeFile } from '@/lib/compression'

type InboundHandler = (message: ClientToServerMessage) => void

/**
 * Mock stream state
 */
export class MockStream {
  private inboundHandlers: InboundHandler[] = []
  private originalBroadcast = streamModule.broadcast

  /**
   * Setup stream mocks
   */
  setup() {
    this.inboundHandlers = []
    mock.module('@/stream', () => ({
      ...streamModule,
      onInboundMessage: (handler: InboundHandler) => {
        this.inboundHandlers.push(handler)
        return () => {
          const index = this.inboundHandlers.indexOf(handler)
          if (index > -1) {
            this.inboundHandlers.splice(index, 1)
          }
        }
      },
      broadcast: this.originalBroadcast, // Pass through to real broadcast by default
    }))
  }

  /**
   * Clean up stream mocks
   */
  async cleanup() {
    // Restore broadcast to original
    mock.module('@/stream', () => ({
      ...streamModule,
      broadcast: this.originalBroadcast,
    }))
    await streamModule.stopAllHandlers()
    this.inboundHandlers = []
    mock.restore()
  }

  /**
   * Mock broadcast to throw an error
   */
  mockBroadcastError(error: Error) {
    mock.module('@/stream', () => ({
      ...streamModule,
      onInboundMessage: streamModule.onInboundMessage,
      broadcast: async () => {
        throw error
      },
    }))
  }

  /**
   * Send a mock file content response
   */
  async mockFileContent(content: string) {
    const compressedContent = await compressAndEncodeFile(content)
    this.mockResponse({
      type: 'input',
      data: { content: compressedContent },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock file error response
   */
  mockFileError(error: string) {
    this.mockResponse({
      type: 'input',
      data: { error },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock invalid compressed content response
   */
  mockInvalidCompressedContent() {
    this.mockResponse({
      type: 'input',
      data: { content: '~invalid_compressed_content' },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock directory content response
   */
  async mockDirectoryContent(files: Record<string, string>) {
    const compressedFiles = Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([path, content]) => [
          path,
          await compressAndEncodeFile(content),
        ])
      )
    )
    this.mockResponse({
      type: 'input',
      data: { files: compressedFiles },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock directory error response
   */
  mockDirectoryError(error: string) {
    this.mockResponse({
      type: 'input',
      data: { error },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock invalid compressed directory response
   */
  mockInvalidCompressedDirectory() {
    this.mockResponse({
      type: 'input',
      data: { files: { 'test.ts': '~invalid_compressed_content' } },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock directory with invalid files format
   */
  mockInvalidFilesFormat() {
    this.mockResponse({
      type: 'input',
      data: {
        files: 'not_an_object',
      },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock directory with multiple invalid compressed files
   */
  mockInvalidCompressedDirectoryMultiple() {
    this.mockResponse({
      type: 'input',
      data: {
        files: {
          'test.ts': '~invalid_compressed_content',
          'test2.ts': '~another_invalid_content',
        },
      },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock empty response
   */
  mockEmptyResponse() {
    this.mockResponse({
      type: 'input',
      data: {},
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock invalid response
   */
  mockInvalidResponse() {
    this.mockResponse({
      type: 'input',
      data: 'invalid',
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock null response
   */
  mockNullResponse() {
    this.mockResponse({
      type: 'input',
      data: null,
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock response processing error
   */
  mockResponseProcessingError() {
    this.mockResponse({
      type: 'input',
      data: { content: { invalid: 'data' }, files: { invalid: 'data' } },
      timestamp: Date.now(),
    })
  }

  /**
   * Send a mock response to all handlers
   */
  private mockResponse(message: ClientToServerMessage) {
    for (const handler of this.inboundHandlers) {
      handler(message)
    }
  }
}

/**
 * Create a new mock stream instance
 */
export function createMockStream() {
  return new MockStream()
}
