import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import { getFile, getDirectory } from '@/lib/file'
import { DEFAULT_AGENT_CONFIG } from '@/types'
import { mockClientResponse, mockStream } from '@/tests/unit/utils'
import { compressAndEncodeMessage } from '@/lib/compression'
import * as streamModule from '@/stream'
import type { StreamMessage } from '@/stream'

describe('File Library', () => {
  let mockResponse: ReturnType<typeof mock>

  beforeEach(() => {
    mockResponse = mock(() => {})
    mockResponse.prototype = Response.prototype
  })

  afterEach(() => {
    mock.restore()
  })

  const testConfig = {
    ...DEFAULT_AGENT_CONFIG,
    userInputTimeout: 100, // Short timeout for faster tests
  }

  describe('getFile', () => {
    test('should get file content', async () => {
      const content = 'test content'
      mockClientResponse(mockResponse, { content })

      const result = await getFile('test.ts', testConfig)
      expect(result).toBe(content)
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should propagate file error from response', async () => {
      const error = 'test error'
      mockClientResponse(mockResponse, { error })

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty('message', error)
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should timeout when no response received', async () => {
      mockStream(mockResponse, new ReadableStream({ start() {} }))

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty('message', expect.stringContaining('timeout'))
    }, 1000)

    test('should reject when response missing required fields', async () => {
      mockClientResponse(mockResponse, {})

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('should reject when response body missing', async () => {
      mockResponse.mockImplementation(() => ({ body: null }) as Response)

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('should reject non-edit response type', async () => {
      mockClientResponse(mockResponse, { type: 'chat', data: {} })

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should propagate stream errors', async () => {
      const streamError = new Error('test stream error')
      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            controller.error(streamError)
          },
        })
      )

      const promise = getFile('test.ts', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty(
        'message',
        expect.stringContaining(streamError.message)
      )
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should handle file read timeout', async () => {
      const path = 'test.ts'
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        userInputTimeout: 100,
      }

      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.close()
            }, 200)
          },
        })
      )

      await expect(getFile(path, config)).rejects.toThrow('File request timeout')
    })

    test('should handle stream ending without response', async () => {
      const path = 'test.ts'
      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      )

      await expect(getFile(path)).rejects.toThrow('Stream ended without response')
    })

    test('should handle invalid response type', async () => {
      const path = 'test.ts'
      mockClientResponse(mockResponse, { type: 'invalid', data: {} })

      const promise = getFile(path)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty(
        'message',
        'Response missing both content and error'
      )
    })

    test('should handle missing content and error', async () => {
      const path = 'test.ts'
      mockClientResponse(mockResponse, { type: 'edit', data: {} })

      await expect(getFile(path)).rejects.toThrow()
    })

    test('should handle stream reader creation failure', async () => {
      const path = 'test.ts'
      mockResponse.mockImplementation(() => ({ body: null }) as Response)

      await expect(getFile(path)).rejects.toThrow()
    })
  })

  describe('getDirectory', () => {
    test('should get directory files', async () => {
      const files = { 'test/test.ts': 'content', 'test/test2.ts': 'content2' }
      mockClientResponse(mockResponse, { files })

      const result = await getDirectory('test', testConfig)
      expect(result).toEqual(files)
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should propagate directory error from response', async () => {
      const error = 'test error'
      mockClientResponse(mockResponse, { error })

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty('message', error)
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should timeout when no response received', async () => {
      mockStream(mockResponse, new ReadableStream({ start() {} }))

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty('message', expect.stringContaining('timeout'))
      expect(mockResponse).toHaveBeenCalled()
    }, 1000)

    test('should reject when response missing required fields', async () => {
      mockClientResponse(mockResponse, {})

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('should reject when response body missing', async () => {
      mockResponse.mockImplementation(() => ({ body: null }) as Response)

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('should reject non-edit response type', async () => {
      mockClientResponse(mockResponse, { type: 'chat', data: {} })

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
    })

    test('should propagate stream errors', async () => {
      const streamError = new Error('test stream error')
      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            controller.error(streamError)
          },
        })
      )

      const promise = getDirectory('test', testConfig)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty(
        'message',
        expect.stringContaining(streamError.message)
      )
      expect(mockResponse).toHaveBeenCalled()
    })

    test('should handle directory read timeout', async () => {
      const path = 'test'
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        userInputTimeout: 100,
      }

      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.close()
            }, 200)
          },
        })
      )

      await expect(getDirectory(path, config)).rejects.toThrow('Directory request timeout')
    })

    test('should handle stream ending without response', async () => {
      const path = 'test'
      mockStream(
        mockResponse,
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      )

      await expect(getDirectory(path)).rejects.toThrow('Stream ended without response')
    })

    test('should handle invalid response type', async () => {
      const path = 'test'
      mockClientResponse(mockResponse, { type: 'invalid', data: {} })

      const promise = getDirectory(path)
      await expect(promise).rejects.toBeInstanceOf(Error)
      await expect(promise).rejects.toHaveProperty(
        'message',
        'Response missing both files and error'
      )
    })

    test('should handle missing files and error', async () => {
      const path = 'test'
      mockClientResponse(mockResponse, { type: 'edit', data: {} })

      await expect(getDirectory(path)).rejects.toThrow()
    })

    test('should handle stream reader creation failure', async () => {
      const path = 'test'
      mockResponse.mockImplementation(() => ({ body: null }) as Response)

      await expect(getDirectory(path)).rejects.toThrow()
    })

    test('should pass include and exclude patterns', async () => {
      const files = { 'test/test.ts': 'content' }
      let capturedRequest: any
      let capturePromise = Promise.resolve()

      // Mock the response with proper message structure
      mockClientResponse(mockResponse, { files })

      // Mock the stream module
      const streamSpy = mock.module('@/stream', () => ({
        ...streamModule,
        createStreamResponse: (messages: AsyncIterable<StreamMessage>) => {
          console.log('createStreamResponse called')
          // Capture the first message from the iterator
          capturePromise = messages[Symbol.asyncIterator]()
            .next()
            .then(({ value }) => {
              console.log('Request captured:', value)
              capturedRequest = value
            })
          // Return a new response with the mock stream
          return new Response(
            new ReadableStream({
              start(controller) {
                const compressed = compressAndEncodeMessage({ type: 'edit', data: { files } })
                controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
                controller.close()
              },
            }),
            {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            }
          )
        },
      }))

      const result = await getDirectory('test', testConfig, '*.ts', '*.test.ts')
      console.log('Result received:', result)
      await capturePromise
      console.log('Request captured:', capturedRequest)

      // Verify the result
      expect(result).toEqual(files)
      expect(mockResponse).toHaveBeenCalledTimes(1)

      // Verify the request patterns
      expect(capturedRequest.data).toHaveProperty('includePattern', '*.ts')
      expect(capturedRequest.data).toHaveProperty('excludePattern', '*.test.ts')
    })
  })
})
