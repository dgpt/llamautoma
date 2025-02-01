import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { Server } from '../../src/server'
import { v4 as uuidv4 } from 'uuid'
import { DynamicTool } from '@langchain/core/tools'
import { logger } from '../../src/utils/logger'

describe('Server Integration Tests', () => {
  let server: Server

  beforeAll(async () => {
    logger.debug('Starting server for tests')
    server = new Server({
      port: 3001,
      modelName: 'qwen2.5-coder:1.5b',
      host: 'http://localhost:11434',
      tools: []
    })
    await server.start()
    logger.debug('Server started')
  })

  afterAll(async () => {
    logger.debug('Stopping server')
    await server.stop()
    logger.debug('Server stopped')
  })

  test('should handle chat endpoint', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting chat endpoint test')

    const response = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'What is TypeScript?' }
        ],
        threadId
      })
    })
    logger.debug({ status: response.status }, 'Chat response received')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = response.body?.getReader()
    if (reader) {
      logger.debug('Reading response stream')
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('data:')
      await reader.cancel()
      logger.debug('Stream reading complete')
    }
    logger.debug('Chat endpoint test complete')
  })

  test('should handle tool registration and execution', async () => {
    logger.debug('Starting tool registration test')
    const testTool = new DynamicTool({
      name: 'test-tool',
      description: 'A test tool',
      func: async (input: string) => `Processed: ${input}`
    })

    const registrationResponse = await fetch('http://localhost:3001/tools', {
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
    })
    logger.debug({ status: registrationResponse.status }, 'Tool registration response received')

    expect(registrationResponse.status).toBe(200)
    const registration = await registrationResponse.json()
    expect(registration.success).toBe(true)
    expect(registration.toolId).toBeDefined()
    logger.debug({ toolId: registration.toolId }, 'Tool registered')

    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting tool execution')
    const executionResponse = await fetch('http://localhost:3001/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: registration.toolId,
        input: { input: 'test value' },
        threadId
      })
    })
    logger.debug({ status: executionResponse.status }, 'Tool execution response received')

    expect(executionResponse.status).toBe(200)
    const reader = executionResponse.body?.getReader()
    if (reader) {
      logger.debug('Reading execution response stream')
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('Processed:')
      await reader.cancel()
      logger.debug('Execution stream reading complete')
    }
    logger.debug('Tool registration and execution test complete')
  })

  test('should handle cross-thread memory persistence', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()
    logger.debug({ threadId1, threadId2 }, 'Starting cross-thread test')

    logger.debug('Sending first message')
    const response1 = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Remember that the sky is blue.' }
        ],
        threadId: threadId1
      })
    })
    logger.debug({ status: response1.status }, 'First message response received')

    expect(response1.status).toBe(200)
    const reader1 = response1.body?.getReader()
    if (reader1) {
      logger.debug('Reading first response stream')
      await reader1.read()
      await reader1.cancel()
      logger.debug('First stream reading complete')
    }

    logger.debug('Sending second message')
    const response2 = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'What color is the sky?' }
        ],
        threadId: threadId2
      })
    })
    logger.debug({ status: response2.status }, 'Second message response received')

    expect(response2.status).toBe(200)
    const reader2 = response2.body?.getReader()
    if (reader2) {
      logger.debug('Reading second response stream')
      const { value } = await reader2.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('blue')
      await reader2.cancel()
      logger.debug('Second stream reading complete')
    }
    logger.debug('Cross-thread test complete')
  })
})