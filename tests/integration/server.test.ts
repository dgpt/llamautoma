import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { DynamicTool } from '@langchain/core/tools'
import { logger } from '@/logger'
import server from '@/index'
import { parseXMLContent, validateXMLResponse, validateXMLTypes } from '@/xml'

interface StreamEvent {
  event: string
  threadId?: string
  data?: {
    type?: string
    content?: string
    xmlType?: string
    xmlContent?: string
  }
}

const processStreamChunk = (chunk: Uint8Array, partialLine: string): [StreamEvent[], string] => {
  const events: StreamEvent[] = []
  const decoder = new TextDecoder()
  const textChunk: string = partialLine + decoder.decode(chunk)
  const lines = textChunk.split('\n')
  const remainingPartialLine = lines.pop() || ''

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

    try {
      const data = JSON.parse(trimmedLine.slice(6)) as StreamEvent
      if (data && data.data?.content) {
        const xmlData = parseXMLContent(data.data.content)
        if (xmlData) {
          data.data.xmlType = xmlData.type
          data.data.xmlContent = xmlData.raw
        }
      }
      events.push(data)
    } catch (error) {
      logger.error('Error parsing SSE event:', { line: trimmedLine, error })
    }
  }

  return [events, remainingPartialLine]
}

const readStreamWithTimeout = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxAttempts = 10
): Promise<StreamEvent[]> => {
  const allEvents: StreamEvent[] = []
  let attempts = 0
  let partialLine = ''

  while (attempts < maxAttempts) {
    try {
      const { done, value } = await reader.read()
      if (done) break

      if (value) {
        const [events, remaining] = processStreamChunk(value, partialLine)
        partialLine = remaining
        allEvents.push(...events)

        // Check if we've received an end event
        const hasEndEvent = events.some(event => event.event === 'end')
        if (hasEndEvent) break
      }
    } catch (error) {
      logger.error('Stream read error:', { error })
      throw error // Propagate the error for proper test failure
    }
    attempts++
  }

  return allEvents
}

const findEventByPredicate = (
  events: StreamEvent[],
  predicate: (event: StreamEvent) => boolean
): boolean => {
  if (!Array.isArray(events)) return false
  for (const event of events) {
    try {
      if (!event) continue
      if (predicate(event)) return true
    } catch {
      continue
    }
  }
  return false
}

const validateStreamEventXMLResponse = (event: StreamEvent, type: string): boolean => {
  if (!event?.event || event.event !== 'message') return false
  if (!event.data?.xmlType || !event.data.xmlContent) return false
  return validateXMLResponse(event.data.xmlContent, type)
}

const validateStreamEventXMLContent = (
  event: StreamEvent,
  type: string,
  contentPredicate?: (content: string) => boolean
): boolean => {
  if (!event?.event || event.event !== 'message') return false
  if (!event.data?.xmlType || !event.data.xmlContent) return false

  const xmlData = parseXMLContent(event.data.xmlContent)
  if (!xmlData) return false
  if (!contentPredicate) return true

  return contentPredicate(xmlData.content)
}

const validateStreamEventXMLTypes = (event: StreamEvent, types: string[]): boolean => {
  if (!event?.event || event.event !== 'message') return false
  if (!event.data?.xmlType || !event.data.xmlContent) return false
  return validateXMLTypes(event.data.xmlContent, types)
}

const countMatchingEvents = (
  events: StreamEvent[],
  predicate: (event: StreamEvent) => boolean
): number => {
  if (!Array.isArray(events)) return 0
  let count = 0
  for (const event of events) {
    try {
      if (!event) continue
      const result = predicate(event)
      if (result === true) count++
    } catch {
      continue
    }
  }
  return count
}

const validateEventTypeAndThreadId = (
  event: StreamEvent,
  type: string,
  threadId: string
): boolean => {
  if (!event) return false
  const eventType = event.event
  const eventThreadId = event.threadId
  if (!eventType || !eventThreadId) return false
  return eventType === type && eventThreadId === threadId
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

  test('should handle chat endpoint with basic query and thread persistence', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const threadId = 'test-thread-1'

    try {
      // First chat request
      const response1 = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            threadId,
            messages: [{ role: 'user', content: 'What is TypeScript?' }],
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

      expect(response1.status).toBe(200)
      expect(response1.headers.get('content-type')).toBe('text/event-stream')

      reader = response1.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      const events = await readStreamWithTimeout(reader)

      const foundStart = findEventByPredicate(
        events,
        event => event.event === 'start' && event.threadId === threadId
      )

      const foundMessage = findEventByPredicate(events, event =>
        validateStreamEventXMLTypes(event, ['chat', 'final', 'thought'])
      )

      const foundEnd = findEventByPredicate(
        events,
        event => event.event === 'end' && event.threadId === threadId
      )

      expect(foundStart).toBe(true)
      expect(foundMessage).toBe(true)
      expect(foundEnd).toBe(true)

      await reader.cancel()

      // Second chat request in same thread
      const response2 = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            threadId,
            messages: [{ role: 'user', content: 'What are its key features?' }],
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

      expect(response2.status).toBe(200)

      reader = response2.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      const events2 = await readStreamWithTimeout(reader)

      const foundStartAgain = findEventByPredicate(
        events2,
        event => event.event === 'start' && event.threadId === threadId
      )

      const foundContextualMessage = findEventByPredicate(events2, event => {
        if (!validateStreamEventXMLTypes(event, ['chat', 'final', 'thought'])) return false
        const xmlData = parseXMLContent(event.data?.xmlContent || '')
        return xmlData ? xmlData.content.toLowerCase().includes('typescript') : false
      })

      expect(foundStartAgain).toBe(true)
      expect(foundContextualMessage).toBe(true)
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
        validateStreamEventXMLContent(event, 'tool', content => content.includes(testTool.name))
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
        if (validateStreamEventXMLTypes(event, ['warning', 'error'])) {
          const content = event.data?.xmlContent?.toLowerCase() || ''
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
      const foundThreadId = findEventByPredicate(events, event =>
        validateEventTypeAndThreadId(event, 'start', customThreadId)
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
      func: async (input: string) => `Processed with confirmation: ${input}`,
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
        validateStreamEventXMLContent(event, 'confirmation', content =>
          content.includes(testTool.name)
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
        validateStreamEventXMLContent(event, 'feedback', content => content.includes(testTool.name))
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
      const warningCount = countMatchingEvents(events, event => {
        if (!validateStreamEventXMLTypes(event, ['warning', 'error'])) return false
        const content = event.data?.xmlContent?.toLowerCase() || ''
        return content.includes('dangerous') || content.includes('safety')
      })

      expect(warningCount).toBeGreaterThanOrEqual(2)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should validate XML response format for all response types', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const threadId = 'xml-validation-thread'

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
      const validResponseTypes = new Set(['chat', 'thought', 'code', 'final'])
      const foundResponseTypes = new Set<string>()

      for (const event of events) {
        if (event.data?.xmlType && validResponseTypes.has(event.data.xmlType)) {
          foundResponseTypes.add(event.data.xmlType)
          const content = event.data.xmlContent
          if (!content) continue

          switch (event.data.xmlType) {
            case 'chat':
            case 'thought':
              expect(content).toMatch(/<content>.*<\/content>/s)
              break
            case 'code':
              expect(content).toMatch(/<language>.*<\/language>/s)
              expect(content).toMatch(/<code>.*<\/code>/s)
              break
            case 'final':
              expect(content).toMatch(/<summary>.*<\/summary>/s)
              break
          }
        }
      }

      expect(foundResponseTypes.size).toBe(validResponseTypes.size)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle safety checks with multiple dangerous patterns', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const dangerousPatterns = [
      'rm -rf /',
      'DROP TABLE',
      'sudo rm',
      'wget http',
      'curl -X',
      'eval(',
      'exec(',
    ]

    try {
      const response = await server.fetch(
        new Request('http://localhost:3001/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat',
            messages: [
              {
                role: 'user',
                content:
                  'Use rm -rf / and then DROP TABLE users; also try wget http://malicious.com',
              },
            ],
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

      // Verify warning events for each dangerous pattern
      const warningEvents = events.filter(
        event =>
          validateStreamEventXMLTypes(event, ['warning', 'error']) &&
          event.data?.xmlContent?.toLowerCase().includes('dangerous')
      )

      // Should have at least one warning for each detected pattern
      expect(warningEvents.length).toBeGreaterThanOrEqual(3)

      // Verify specific warnings
      expect(
        warningEvents.some(event => event.data?.xmlContent?.toLowerCase().includes('rm -rf'))
      ).toBe(true)

      expect(
        warningEvents.some(event => event.data?.xmlContent?.toLowerCase().includes('drop table'))
      ).toBe(true)

      expect(
        warningEvents.some(event => event.data?.xmlContent?.toLowerCase().includes('wget'))
      ).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should validate XML response format and content structure', async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const threadId = 'xml-validation-thread'

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
      const chatEvents = events.filter(event => validateStreamEventXMLResponse(event, 'chat'))
      expect(chatEvents.length).toBeGreaterThan(0)
      chatEvents.forEach(event => {
        expect(event.data?.xmlContent).toMatch(/<content>.*<\/content>/s)
      })

      // Verify code examples
      const codeEvents = events.filter(event => validateStreamEventXMLResponse(event, 'code'))
      expect(codeEvents.length).toBeGreaterThan(0)
      codeEvents.forEach(event => {
        const content = event.data?.xmlContent || ''
        expect(content).toMatch(/<language>.*<\/language>/s)
        expect(content).toMatch(/<code>.*<\/code>/s)
      })

      // Verify final summary
      const finalEvents = events.filter(event => validateStreamEventXMLResponse(event, 'final'))
      expect(finalEvents.length).toBeGreaterThan(0)
      finalEvents.forEach(event => {
        expect(event.data?.xmlContent).toMatch(/<summary>.*<\/summary>/s)
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
