import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import app from '@/index'
import { stream } from '@/stream'
import { decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'

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

describe('Server Integration', () => {
  let server: Elysia
  const testPort = 3001

  beforeAll(() => {
    server = app
    server.listen(testPort)
  })

  afterAll(() => {
    server.stop()
  })

  describe('Health Check', () => {
    test('should return ok status', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ status: 'ok' })
    })
  })

  describe('Chat Endpoint', () => {
    test('should handle chat request with streaming response', async () => {
      const response = await fetch(`http://localhost:${testPort}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Thread-ID': 'test-thread',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      const reader = response.body!.getReader()
      const events = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].event).toBe('start')
      expect(events[events.length - 1].event).toBe('end')
    })

    test('should handle chat errors gracefully', async () => {
      const response = await fetch(`http://localhost:${testPort}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Thread-ID': 'test-thread',
        },
        body: 'invalid json',
      })

      expect(response.status).toBe(200) // Still returns 200 as it's streaming
      const reader = response.body!.getReader()
      const events = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events.some(e => e.type === 'error')).toBe(true)
    })
  })

  describe('Sync Endpoint', () => {
    test('should handle sync request with streaming response', async () => {
      const response = await fetch(`http://localhost:${testPort}/v1/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Thread-ID': 'test-thread',
        },
        body: JSON.stringify({
          root: '/test/path',
          excludePatterns: ['node_modules/**'],
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      const reader = response.body!.getReader()
      const events = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].event).toBe('start')
      expect(events.some(e => e.type === 'progress')).toBe(true)
      expect(events.some(e => e.type === 'complete')).toBe(true)
    })

    test('should handle sync errors gracefully', async () => {
      const response = await fetch(`http://localhost:${testPort}/v1/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Thread-ID': 'test-thread',
        },
        body: 'invalid json',
      })

      expect(response.status).toBe(200) // Still returns 200 as it's streaming
      const reader = response.body!.getReader()
      const events = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events.some(e => e.type === 'error')).toBe(true)
    })
  })
})
