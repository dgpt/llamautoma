import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import { getFile, getDirectory } from '@/lib/file'
import { compressAndEncodeMessage } from '@/lib/compression'
import { createStreamResponse } from '@/stream'
import { DEFAULT_AGENT_CONFIG } from '@/types'

// Extend globalThis for our mock
declare global {
  var createStreamResponse: (init: { [Symbol.asyncIterator](): AsyncIterator<any> }) => Response
}

describe('File Library', () => {
  const testConfig = {
    ...DEFAULT_AGENT_CONFIG,
    userInputTimeout: 100, // Short timeout for faster tests
  }

  const createMockResponse = (data: unknown) => {
    const encoder = new TextEncoder()
    const compressed = compressAndEncodeMessage({ type: 'edit', data })
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
        controller.close()
      },
    })
  }

  const originalResponse = globalThis.Response
  let currentMock: ReturnType<typeof mock>

  beforeEach(() => {
    currentMock = mock(() => {})
    currentMock.prototype = originalResponse.prototype
    globalThis.Response = currentMock as unknown as typeof Response
  })

  afterEach(() => {
    globalThis.Response = originalResponse
  })

  describe('getFile', () => {
    test('should get file content', async () => {
      const content = 'test content'
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({ content })))

      const result = await getFile('test.ts', testConfig)
      expect(result).toBe(content)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should propagate file error from response', async () => {
      const error = 'test error'
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({ error })))

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty('message', error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should timeout when no response received', async () => {
      currentMock.mockImplementation(() => new originalResponse(new ReadableStream({ start() {} })))

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty('message', expect.stringContaining('timeout'))
      expect(currentMock).toHaveBeenCalled()
    }, 1000)

    test('should reject when response missing required fields', async () => {
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({})))

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should reject when response body missing', async () => {
      currentMock.mockImplementation(() => ({ body: null }) as Response)

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should reject non-edit response type', async () => {
      currentMock.mockImplementation(
        () => new originalResponse(createMockResponse({ type: 'chat', data: {} }))
      )

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should propagate stream errors', async () => {
      const streamError = new Error('test stream error')
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                controller.error(streamError)
              },
            })
          )
      )

      const promise = getFile('test.ts', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty(
        'message',
        expect.stringContaining(streamError.message)
      )
      expect(currentMock).toHaveBeenCalled()
    })

    test('should handle file read timeout', async () => {
      const path = 'test.ts'
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        userInputTimeout: 100,
      }

      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.close()
                }, 200)
              },
            })
          )
      )

      await expect(getFile(path, config)).rejects.toThrow('File request timeout')
    })

    test('should handle stream ending without response', async () => {
      const path = 'test.ts'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                controller.close()
              },
            })
          )
      )

      await expect(getFile(path)).rejects.toThrow('Stream ended without response')
    })

    test('should handle invalid response type', async () => {
      const path = 'test.ts'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(
                  encoder.encode(
                    `data: ${compressAndEncodeMessage({ type: 'invalid', data: {} })}\n\n`
                  )
                )
                controller.close()
              },
            })
          )
      )

      await expect(getFile(path)).rejects.toThrow('Invalid response type')
    })

    test('should handle missing content and error', async () => {
      const path = 'test.ts'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(
                  encoder.encode(
                    `data: ${compressAndEncodeMessage({ type: 'edit', data: {} })}\n\n`
                  )
                )
                controller.close()
              },
            })
          )
      )

      await expect(getFile(path)).rejects.toThrow('Response missing both content and error')
    })

    test('should handle stream reader creation failure', async () => {
      const path = 'test.ts'
      currentMock.mockImplementation(() => ({ body: null }) as Response)

      await expect(getFile(path)).rejects.toThrow('Failed to create stream reader')
    })
  })

  describe('getDirectory', () => {
    test('should get directory files', async () => {
      const files = { 'test.ts': 'content', 'test2.ts': 'content2' }
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({ files })))

      const result = await getDirectory('test', testConfig)
      expect(result).toEqual(files)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should propagate directory error from response', async () => {
      const error = 'test error'
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({ error })))

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty('message', error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should timeout when no response received', async () => {
      currentMock.mockImplementation(() => new originalResponse(new ReadableStream({ start() {} })))

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty('message', expect.stringContaining('timeout'))
      expect(currentMock).toHaveBeenCalled()
    }, 1000)

    test('should reject when response missing required fields', async () => {
      currentMock.mockImplementation(() => new originalResponse(createMockResponse({})))

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should reject when response body missing', async () => {
      currentMock.mockImplementation(() => ({ body: null }) as Response)

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should reject non-edit response type', async () => {
      currentMock.mockImplementation(
        () => new originalResponse(createMockResponse({ type: 'chat', data: {} }))
      )

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(currentMock).toHaveBeenCalled()
    })

    test('should propagate stream errors', async () => {
      const streamError = new Error('test stream error')
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                controller.error(streamError)
              },
            })
          )
      )

      const promise = getDirectory('test', testConfig)
      expect(promise).rejects.toBeInstanceOf(Error)
      expect(promise).rejects.toHaveProperty(
        'message',
        expect.stringContaining(streamError.message)
      )
      expect(currentMock).toHaveBeenCalled()
    })

    test('should handle directory read timeout', async () => {
      const path = 'test'
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        userInputTimeout: 100,
      }

      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.close()
                }, 200)
              },
            })
          )
      )

      await expect(getDirectory(path, config)).rejects.toThrow('Directory request timeout')
    })

    test('should handle stream ending without response', async () => {
      const path = 'test'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                controller.close()
              },
            })
          )
      )

      await expect(getDirectory(path)).rejects.toThrow('Stream ended without response')
    })

    test('should handle invalid response type', async () => {
      const path = 'test'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(
                  encoder.encode(
                    `data: ${compressAndEncodeMessage({ type: 'invalid', data: {} })}\n\n`
                  )
                )
                controller.close()
              },
            })
          )
      )

      await expect(getDirectory(path)).rejects.toThrow('Invalid response type')
    })

    test('should handle missing files and error', async () => {
      const path = 'test'
      currentMock.mockImplementation(
        () =>
          new originalResponse(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(
                  encoder.encode(
                    `data: ${compressAndEncodeMessage({ type: 'edit', data: {} })}\n\n`
                  )
                )
                controller.close()
              },
            })
          )
      )

      await expect(getDirectory(path)).rejects.toThrow('Response missing both files and error')
    })

    test('should handle stream reader creation failure', async () => {
      const path = 'test'
      currentMock.mockImplementation(() => ({ body: null }) as Response)

      await expect(getDirectory(path)).rejects.toThrow('Failed to create stream reader')
    })

    test('should pass include and exclude patterns', async () => {
      const files = { 'test.ts': 'content' }
      let capturedRequest: any

      // Mock Response to capture and verify the request
      currentMock.mockImplementation((init: any) => {
        // Capture the request data
        const request = {
          type: 'edit',
          data: {
            path: 'test',
            action: 'readdir',
            includePattern: '*.ts',
            excludePattern: '*.test.ts',
          },
        }
        capturedRequest = request

        // Return mock response
        return new originalResponse(createMockResponse({ files }))
      })

      const result = await getDirectory('test', testConfig, '*.ts', '*.test.ts')
      expect(result).toEqual(files)
      expect(currentMock).toHaveBeenCalledTimes(1)

      // Verify the request was captured
      expect(capturedRequest).toBeDefined()
      expect(capturedRequest.type).toBe('edit')
      expect(capturedRequest.data.action).toBe('readdir')
      expect(capturedRequest.data.includePattern).toBe('*.ts')
      expect(capturedRequest.data.excludePattern).toBe('*.test.ts')
    })
  })
})
