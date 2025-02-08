import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import { getFile } from '@/lib/file'
import { compressAndEncodeMessage } from '@/lib/compression'
import { DEFAULT_AGENT_CONFIG } from '@/types'
import { createStreamResponse, readClientStream } from '@/stream'

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
    expect(promise).rejects.toHaveProperty('message', expect.stringContaining(streamError.message))
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
                encoder.encode(`data: ${compressAndEncodeMessage({ type: 'edit', data: {} })}\n\n`)
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
