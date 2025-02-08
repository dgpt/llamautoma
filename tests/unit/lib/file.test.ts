import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import { getFile } from '@/lib/file'
import { compressAndEncodeMessage } from '@/lib/compression'
import { DEFAULT_AGENT_CONFIG } from '@/types'

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
})
