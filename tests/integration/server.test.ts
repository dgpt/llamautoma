import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { DynamicTool } from '@langchain/core/tools'
import { logger } from '@/logger'
import server from '@/index'
import { ReActResponseSchema } from '@/types/agent'

interface StreamEvent {
  event: string
  threadId?: string
  data?: {
    content?: string
    error?: string
  }
}

const findEventByPredicate = (
  events: StreamEvent[],
  predicate: (event: StreamEvent) => boolean
) => {
  return events.some(predicate)
}

const readStreamWithTimeout = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number = 30000
): Promise<StreamEvent[]> => {
  const allEvents: StreamEvent[] = []
  let attempts = 0
  let partialLine = ''

  while (attempts < timeout) {
    try {
      const { done, value } = await reader.read()
      if (done) break

      const text = new TextDecoder().decode(value)
      const lines = (partialLine + text).split('\n')
      partialLine = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine === '') continue

        if (!trimmedLine.startsWith('data: ')) {
          logger.warn('Unexpected SSE line format:', { line: trimmedLine })
          continue
        }

        try {
          const data = JSON.parse(trimmedLine.slice(6)) as StreamEvent
          if (data && data.data?.content) {
            allEvents.push(data)
          }
        } catch (error) {
          logger.error('Error parsing SSE event:', { line: trimmedLine, error })
        }
      }

      attempts++
    } catch (error) {
      logger.error('Error reading stream:', error)
      break
    }
  }

  return allEvents
}

const validateStreamEventResponse = (event: StreamEvent, type: string): boolean => {
  if (!event.data?.content) return false
  try {
    const response = JSON.parse(event.data.content)
    if (type === 'start') {
      // For start events, we only care about the type
      return response.type === type
    }
    return ReActResponseSchema.safeParse(response).success && response.type === type
  } catch {
    return false
  }
}

const validateStreamEventContent = (
  event: StreamEvent,
  type: string,
  contentPredicate: (content: any) => boolean
): boolean => {
  if (!event.data?.content) return false
  try {
    const response = JSON.parse(event.data.content)
    if (type === 'start') {
      // For start events, we only care about the type
      return response.type === type && contentPredicate(response)
    }
    return (
      ReActResponseSchema.safeParse(response).success &&
      response.type === type &&
      contentPredicate(response)
    )
  } catch {
    return false
  }
}

describe('Server Integration Tests', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    logger.trace('Starting server for tests')
  })

  afterAll(() => {
    process.env.NODE_ENV = 'development'
    logger.trace('Server stopped')
  })

  test('should handle basic chat interaction', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: 'Tell me about TypeScript' }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              maxInputLength: 8192,
            },
          }),
        })
      )

      expect(response.status).toBe(200)
      reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      const events = await readStreamWithTimeout(reader)

      // First check for start event
      const foundStart = findEventByPredicate(events, event => {
        return event.event === 'start' && event.data?.content !== undefined
      })
      expect(foundStart).toBe(true)

      // Then check for TypeScript content in any message
      const foundTypescriptResponse = findEventByPredicate(events, event => {
        if (!event.data?.content) return false
        try {
          const content = event.data.content.toLowerCase()
          return content.includes('typescript') || content.includes('using typescript')
        } catch {
          return false
        }
      })

      expect(foundTypescriptResponse).toBe(true)

      // Finally check for end event
      const foundEnd = findEventByPredicate(events, event => {
        return event.event === 'end' && event.data?.content !== undefined
      })
      expect(foundEnd).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle invalid request method', async () => {
    const response = await server.fetch(
      new Request('http://localhost:3001/chat', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(405)
    const data = await response.json()
    expect(data.error).toBe('Method not allowed')
  })

  test('should handle invalid JSON in request body', async () => {
    const response = await server.fetch(
      new Request('http://localhost:3001/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      })
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Invalid JSON in request body')
  })

  test('should handle invalid chat request without messages', async () => {
    const response = await server.fetch(
      new Request('http://localhost:3001/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
        }),
      })
    )

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Request processing failed')
    expect(data.details).toContain('Invalid chat request: messages array is required')
  })

  test('should handle invalid endpoint', async () => {
    const response = await server.fetch(
      new Request('http://localhost:3001/invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    )

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Not found')
  })

  test('should handle chat request with custom thread ID and configurable', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const customThreadId = 'test-thread-123'

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            threadId: customThreadId,
            messages: [{ role: 'user', content: 'Hello' }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            configurable: {
              checkpoint_ns: 'custom-namespace',
              [Symbol.toStringTag]: 'AgentConfigurable',
            },
            safetyConfig: {
              maxInputLength: 8192,
            },
          }),
        })
      )

      expect(response.status).toBe(200)
      reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      const events = await readStreamWithTimeout(reader)

      // Check for start event with correct thread ID
      const foundThreadId = findEventByPredicate(events, event => {
        return event.event === 'start' && event.threadId === customThreadId
      })
      expect(foundThreadId).toBe(true)

      // Verify thread ID is consistent across all events
      const allEventsHaveCorrectThreadId = events.every(event => event.threadId === customThreadId)
      expect(allEventsHaveCorrectThreadId).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should enforce maxInputLength safety check', async () => {
    const longInput = 'a'.repeat(8193) // Exceeds maxInputLength of 8192
    const response = await server.fetch(
      new Request('http://localhost:3001/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          messages: [{ role: 'user', content: longInput }],
          modelName: 'qwen2.5-coder:1.5b',
          host: 'http://localhost:11434',
          safetyConfig: {
            maxInputLength: 8192,
          },
        }),
      })
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Input exceeds maximum length')
  })
})
