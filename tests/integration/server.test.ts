import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { v4 as uuidv4 } from 'uuid'
import { DynamicTool } from '@langchain/core/tools'
import { logger } from '../../src/utils/logger'
import server from 'src/'

const readStreamWithTimeout = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  try {
    const result = await reader.read()
    if (!result || result.done) {
      return ''
    }

    const value = result.value as Uint8Array
    const text = new TextDecoder().decode(value)

    // Only return actual SSE data lines
    const lines = text.split('\n')
    const dataLines = lines
      .filter(line => line.startsWith('data: '))
      .map(line => line.slice(6)) // Remove 'data: ' prefix

    return dataLines.join('\n')
  } catch (error) {
    logger.error(`Stream read error: ${error?.constructor.name}`)
    throw error
  }
}

describe('Server Integration Tests', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    logger.trace('Starting server for tests')
    logger.trace('Server started')
  })

  afterAll(async () => {
    logger.trace('Stopping server')
    process.env.NODE_ENV = 'development'
    logger.trace('Server stopped')
  })

  test('should handle chat endpoint', async () => {
    const threadId = uuidv4()
    logger.trace(`Starting chat endpoint test: ${threadId}`)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const response = await server.fetch(new Request('http://localhost:3001', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          messages: [
            { role: 'user', content: 'What is TypeScript?' }
          ],
          threadId,
          modelName: 'qwen2.5-coder:1.5b',
          host: 'http://localhost:11434',
          safetyConfig: {
            requireToolConfirmation: false,
            requireToolFeedback: false,
            maxInputLength: 8192,
            dangerousToolPatterns: []
          }
        })
      }))

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')

      reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      let foundResponse = false
      while (!foundResponse) {
        const text = await readStreamWithTimeout(reader)
        if (!text) continue

        try {
          const data = JSON.parse(text)
          if (data.event === 'on_chain_end' || data.event === 'on_llm_end') {
            foundResponse = true
            break
          }
        } catch (e) {
          continue
        }
      }

      expect(foundResponse).toBe(true)
    } finally {
      if (reader) {
        await reader.cancel()
      }
    }
  })

  test('should handle tool registration and execution', async () => {
    const testTool = new DynamicTool({
      name: 'test-tool',
      description: 'A test tool',
      func: async (input: string) => `Processed: ${input}`
    })

    // Register tool first
    const registrationResponse = await server.fetch(new Request('http://localhost:3001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tool',
        name: testTool.name,
        description: testTool.description,
        schema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          },
          required: ['input']
        }
      })
    }))

    expect(registrationResponse.status).toBe(200)
    const registration = await registrationResponse.json()
    expect(registration.success).toBe(true)
    expect(registration.toolId).toBeDefined()

    // Execute tool
    const threadId = uuidv4()
    const executionResponse = await server.fetch(new Request('http://localhost:3001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat',
        messages: [
          { role: 'user', content: 'Use the test-tool with input "test input"' }
        ],
        threadId,
        modelName: 'qwen2.5-coder:1.5b',
        host: 'http://localhost:11434',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
      })
    }))

    expect(executionResponse.status).toBe(200)
    const reader = executionResponse.body?.getReader()
    if (!reader) {
      throw new Error('No response body reader available')
    }

    try {
      let foundToolResponse = false
      let foundFinalResponse = false
      let foundProcessedOutput = false

      while (!foundToolResponse || !foundFinalResponse || !foundProcessedOutput) {
        const text = await readStreamWithTimeout(reader)
        if (!text) continue

        try {
          const data = JSON.parse(text)

          if (data.event === 'on_tool_start') {
            foundToolResponse = true
          }

          if (data.event === 'on_tool_end' && data.data?.output?.includes('Processed: test input')) {
            foundProcessedOutput = true
          }

          if (data.event === 'on_chain_end' || data.event === 'on_llm_end') {
            foundFinalResponse = true
            break
          }
        } catch (e) {
          continue
        }
      }

      expect(foundToolResponse).toBe(true)
      expect(foundProcessedOutput).toBe(true)
      expect(foundFinalResponse).toBe(true)
    } finally {
      await reader.cancel()
    }
  })

  test('should handle cross-thread memory persistence', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()

    // First message
    const response1 = await server.fetch(new Request('http://localhost:3001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat',
        messages: [
          { role: 'user', content: 'Remember that the sky is blue.' }
        ],
        threadId: threadId1,
        modelName: 'qwen2.5-coder:1.5b',
        host: 'http://localhost:11434',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
      })
    }))

    expect(response1.status).toBe(200)
    const reader1 = response1.body?.getReader()
    if (reader1) {
      try {
        let foundFirstResponse = false
        while (!foundFirstResponse) {
          const text = await readStreamWithTimeout(reader1)
          if (!text) continue

          try {
            const data = JSON.parse(text)
            if (data.event === 'on_chain_end' || data.event === 'on_llm_end') {
              foundFirstResponse = true
              break
            }
          } catch (e) {
            continue
          }
        }
      } finally {
        await reader1.cancel()
      }
    }

    // Second message
    const response2 = await server.fetch(new Request('http://localhost:3001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat',
        messages: [
          { role: 'user', content: 'What color is the sky?' }
        ],
        threadId: threadId2,
        modelName: 'qwen2.5-coder:1.5b',
        host: 'http://localhost:11434',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
      })
    }))

    expect(response2.status).toBe(200)
    const reader2 = response2.body?.getReader()
    if (reader2) {
      try {
        let foundBlueResponse = false
        while (!foundBlueResponse) {
          const text = await readStreamWithTimeout(reader2)
          if (!text) continue

          try {
            const data = JSON.parse(text)
            if ((data.event === 'on_chain_end' || data.event === 'on_llm_end') &&
                data.data?.output?.includes('blue')) {
              foundBlueResponse = true
              break
            }
          } catch (e) {
            continue
          }
        }
      } finally {
        await reader2.cancel()
      }
    }
  })
})
