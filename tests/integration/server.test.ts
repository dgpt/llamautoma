import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import app from '@/index'
import { ServerMessage } from '@/stream'
import { decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'

const testPort = 3001

describe('Server Integration', () => {
  let server: Elysia

  beforeAll(() => {
    server = app.listen(testPort)
  })

  afterAll(() => {
    server.stop()
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
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      const reader = response.body!.getReader()
      const events: ServerMessage[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data as ServerMessage)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('chat')
      expect(events[0].content).toBeDefined()
      expect(events.some(e => e.type === 'chat')).toBe(true)
      expect(events.some(e => e.type === 'status' && e.content === 'Complete')).toBe(true)
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
      const events: ServerMessage[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data as ServerMessage)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('status')
      expect(events.some(e => e.type === 'status' && e.content?.includes('error'))).toBe(true)
    })

    test('should handle MessagePack compression', async () => {
      const response = await fetch(`http://localhost:${testPort}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-msgpack',
          'X-Thread-ID': 'test-thread',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      const reader = response.body!.getReader()
      const events: ServerMessage[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data as ServerMessage)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('chat')
      expect(events[0].content).toBeDefined()
      expect(events.some(e => e.type === 'chat')).toBe(true)
      expect(events.some(e => e.type === 'status' && e.content === 'Complete')).toBe(true)
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
      const events: ServerMessage[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data as ServerMessage)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('status')
      expect(events.some(e => e.type === 'progress')).toBe(true)
      expect(events.some(e => e.type === 'status' && e.content === 'Complete')).toBe(true)
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
      const events: ServerMessage[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = decodeAndDecompressMessage(line.slice(6))
              events.push(data as ServerMessage)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('status')
      expect(events.some(e => e.type === 'status' && e.content?.includes('error'))).toBe(true)
    })
  })
})
