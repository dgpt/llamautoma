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
              requireToolConfirmation: false,
              requireToolFeedback: false,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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
      const foundTypescriptResponse = findEventByPredicate(events, event => {
        if (!event.data?.content) return false
        try {
          const response = JSON.parse(event.data.content)
          return (
            ReActResponseSchema.safeParse(response).success &&
            ['chat', 'final', 'thought'].includes(response.type) &&
            response.content.toLowerCase().includes('typescript')
          )
        } catch {
          return false
        }
      })

      expect(foundTypescriptResponse).toBe(true)
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

  test('should handle tool registration and execution with XML responses', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const testTool = new DynamicTool({
      name: 'test-tool',
      description: 'A test tool',
      func: async (input: string) => `Processed: ${input}`,
    })

    // Register tool
    const registrationResponse = await server.fetch(
      new Request('http://localhost:3001/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool',
          name: testTool.name,
          description: testTool.description,
          args: {
            input: { type: 'string' },
          },
        }),
      })
    )

    expect(registrationResponse.status).toBe(200)
    const registration = await registrationResponse.json()
    expect(registration.success).toBe(true)
    expect(registration.toolId).toBeDefined()
    expect(registration.message).toBe('Tool registered successfully')

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: `Use the ${testTool.name} tool` }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: false,
              requireToolFeedback: false,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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
      const foundToolExecution = findEventByPredicate(events, event =>
        validateStreamEventContent(event, 'tool', content => content.includes(testTool.name))
      )

      expect(foundToolExecution).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle safety checks with dangerous patterns', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const dangerousPatterns = ['rm -rf /', 'DROP TABLE', 'sudo rm', 'wget http']

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: 'Use rm -rf / and then DROP TABLE users' }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: true,
              requireToolFeedback: true,
              maxInputLength: 8192,
              dangerousToolPatterns: dangerousPatterns,
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
      let warningCount = 0

      for (const event of events) {
        if (
          validateStreamEventResponse(event, 'warning') ||
          validateStreamEventResponse(event, 'error')
        ) {
          const content = event.data?.content?.toLowerCase() || ''
          if (content.includes('dangerous') || content.includes('safety')) {
            warningCount++
          }
        }
      }

      expect(warningCount).toBeGreaterThanOrEqual(2)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
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
              requireToolConfirmation: false,
              requireToolFeedback: false,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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
      const foundThreadId = findEventByPredicate(
        events,
        event => validateStreamEventResponse(event, 'start') && event.threadId === customThreadId
      )

      expect(foundThreadId).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle tool request with custom configurable', async () => {
    const testTool = new DynamicTool({
      name: 'configurable-test-tool',
      description: 'A test tool with custom configurable',
      func: async (input: string) => `Processed: ${input}`,
    })

    const response = await server.fetch(
      new Request('http://localhost:3001/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool',
          name: testTool.name,
          description: testTool.description,
          args: {
            input: { type: 'string' },
          },
          configurable: {
            checkpoint_ns: 'custom-tool-namespace',
            [Symbol.toStringTag]: 'AgentConfigurable',
          },
        }),
      })
    )

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.toolId).toBeDefined()
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
            requireToolConfirmation: false,
            requireToolFeedback: false,
            maxInputLength: 8192,
            dangerousToolPatterns: [],
          },
        }),
      })
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Input exceeds maximum length')
  })

  test('should handle tool confirmation requirement', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const testTool = new DynamicTool({
      name: 'confirmation-test-tool',
      description: 'A tool requiring confirmation',
      func: async (input: string) => `Processed: ${input}`,
    })

    // Register tool
    const registrationResponse = await server.fetch(
      new Request('http://localhost:3001/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool',
          name: testTool.name,
          description: testTool.description,
          args: {
            input: { type: 'string' },
          },
        }),
      })
    )

    expect(registrationResponse.status).toBe(200)

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: `Use the ${testTool.name} tool` }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: true,
              requireToolFeedback: false,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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
      const foundConfirmationRequest = findEventByPredicate(events, event =>
        validateStreamEventContent(event, 'confirmation', response =>
          response.content.includes(testTool.name)
        )
      )

      expect(foundConfirmationRequest).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle tool feedback requirement', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const testTool = new DynamicTool({
      name: 'feedback-test-tool',
      description: 'A tool requiring feedback',
      func: async (input: string) => `Processed with feedback: ${input}`,
    })

    // Register tool
    const registrationResponse = await server.fetch(
      new Request('http://localhost:3001/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool',
          name: testTool.name,
          description: testTool.description,
          args: {
            input: { type: 'string' },
          },
        }),
      })
    )

    expect(registrationResponse.status).toBe(200)

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: `Use the ${testTool.name} tool` }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: false,
              requireToolFeedback: true,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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
      const foundFeedbackRequest = findEventByPredicate(events, event =>
        validateStreamEventContent(event, 'feedback', response =>
          response.content.includes(testTool.name)
        )
      )

      expect(foundFeedbackRequest).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle multiple dangerous patterns in safety config', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const dangerousPatterns = ['rm -rf /', 'DROP TABLE', 'sudo rm', 'wget http']

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [{ role: 'user', content: 'Use rm -rf / and then DROP TABLE users' }],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: true,
              requireToolFeedback: true,
              maxInputLength: 8192,
              dangerousToolPatterns: dangerousPatterns,
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
      const warningCount = events.filter(event => {
        if (
          !validateStreamEventResponse(event, 'warning') &&
          !validateStreamEventResponse(event, 'error')
        )
          return false
        const content = event.data?.content?.toLowerCase() || ''
        return content.includes('dangerous') || content.includes('safety')
      }).length

      expect(warningCount).toBeGreaterThanOrEqual(2)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should validate response format and content structure', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const threadId = 'validation-thread'

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            threadId,
            messages: [
              { role: 'user', content: 'Tell me about TypeScript and show some code examples' },
            ],
            modelName: 'qwen2.5-coder:1.5b',
            host: 'http://localhost:11434',
            safetyConfig: {
              requireToolConfirmation: false,
              requireToolFeedback: false,
              maxInputLength: 8192,
              dangerousToolPatterns: [],
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

      // Verify start event
      const startEvent = events.find(event => event.event === 'start')
      expect(startEvent).toBeDefined()
      expect(startEvent?.threadId).toBe(threadId)

      // Verify chat messages
      const chatEvents = events.filter(event => validateStreamEventResponse(event, 'chat'))
      expect(chatEvents.length).toBeGreaterThan(0)
      chatEvents.forEach(event => {
        const response = JSON.parse(event.data?.content || '')
        expect(response.type).toBe('chat')
        expect(typeof response.content).toBe('string')
      })

      // Verify code examples
      const codeEvents = events.filter(event => validateStreamEventResponse(event, 'code'))
      expect(codeEvents.length).toBeGreaterThan(0)
      codeEvents.forEach(event => {
        const response = JSON.parse(event.data?.content || '')
        expect(response.type).toBe('code')
        expect(response.language).toBeDefined()
        expect(response.code).toBeDefined()
      })

      // Verify final summary
      const finalEvents = events.filter(event => validateStreamEventResponse(event, 'final'))
      expect(finalEvents.length).toBeGreaterThan(0)
      finalEvents.forEach(event => {
        const response = JSON.parse(event.data?.content || '')
        expect(response.type).toBe('final')
        expect(typeof response.content).toBe('string')
      })

      // Verify end event
      const endEvent = events.find(event => event.event === 'end')
      expect(endEvent).toBeDefined()
      expect(endEvent?.threadId).toBe(threadId)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })
})
