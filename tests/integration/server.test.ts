import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { Server } from '../../src/server'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { TEST_CONFIG } from '../testConfig'
import { v4 as uuidv4 } from 'uuid'
import { ReActAgent } from '../../src/agents/react/agent'
import { MemoryManager } from '../../src/agents/react/memory/memoryManager'
import { FileSystemTool } from '../../src/agents/react/tools/fileSystemTool'
import { ReActAgentConfig } from '../../src/agents/react/types'
import { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { FileSystemSync } from '../../src/utils/fs'
import { MemorySaver } from '@langchain/langgraph'

// Response schemas
const EmbeddingResponseSchema = z.object({
  success: z.boolean(),
  embeddings: z.array(z.number()),
})

const ToolRegistrationResponseSchema = z.object({
  success: z.boolean(),
  toolId: z.string(),
})

describe('Server Integration Tests', () => {
  let server: Server
  let agent: ReActAgent
  let memory: MemoryManager
  let chat: ChatOllama
  let fileSystemTool: FileSystemTool
  let fs: FileSystemSync
  let checkpointer: MemorySaver

  beforeAll(async () => {
    // Initialize test dependencies
    chat = new ChatOllama({
      model: 'qwen2.5-coder:1.5b', // Using smaller model for tests
      baseUrl: 'http://localhost:11434',
    })
    memory = new MemoryManager()
    fileSystemTool = new FileSystemTool()
    fs = new FileSystemSync()
    checkpointer = new MemorySaver()

    agent = new ReActAgent({
      chatModel: chat,
      llm: chat,
      memory,
      tools: [fileSystemTool],
      safetyConfig: {
        requireToolConfirmation: true,
        requireToolFeedback: true,
        dangerousToolPatterns: ['rm -rf', 'DROP TABLE', 'DELETE FROM'],
      },
    } as ReActAgentConfig)

    server = new Server({
      agent,
      memory,
      port: 3001,
    })

    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('should handle chat endpoint with streaming responses', async () => {
    const threadId = uuidv4()
    const response = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant.' },
          { role: 'user', content: 'What is TypeScript?' },
        ],
        threadId,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data:')
      expect(text).toContain('messages')
      expect(text).toContain('status')
      expect(text).toContain('threadId')

      await reader.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle edit endpoint with file modifications', async () => {
    const threadId = uuidv4()
    const testFile = 'test_edit.txt'
    await fs.writeFile(testFile, 'Initial content')

    const response = await fetch('http://localhost:3001/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: testFile,
        prompt: 'Add a second line saying "New content"',
        threadId,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data:')
      expect(text).toContain('type')
      expect(text).toContain('edit')
      expect(text).toContain('messages')
      expect(text).toContain('status')
      expect(text).toContain('threadId')

      await reader.cancel()
    }

    // Clean up
    await fs.deleteFile(testFile)
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle compose endpoint for file creation', async () => {
    const threadId = uuidv4()
    const response = await fetch('http://localhost:3001/compose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Create a simple TypeScript function that adds two numbers',
        threadId,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data:')
      expect(text).toContain('type')
      expect(text).toContain('compose')
      expect(text).toContain('messages')
      expect(text).toContain('status')
      expect(text).toContain('threadId')

      await reader.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle embed endpoint for text embeddings', async () => {
    const response = await fetch('http://localhost:3001/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'text',
        path: 'test.txt',
        content: 'This is a test content for embedding.',
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(Array.isArray(data.embeddings)).toBe(true)
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle tool registration and execution', async () => {
    // Register a new tool
    const registrationResponse = await fetch('http://localhost:3001/tools', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test-tool',
        description: 'A test tool',
        schema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
          required: ['input'],
        },
      }),
    })

    expect(registrationResponse.status).toBe(200)
    const regData = await registrationResponse.json()
    expect(regData.success).toBe(true)
    expect(regData.toolId).toBeDefined()

    // Execute the registered tool
    const threadId = uuidv4()
    const executionResponse = await fetch('http://localhost:3001/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolId: regData.toolId,
        input: { input: 'test input' },
        threadId,
      }),
    })

    expect(executionResponse.status).toBe(200)
    expect(executionResponse.headers.get('content-type')).toBe('text/event-stream')

    const reader = executionResponse.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data:')
      expect(text).toContain('messages')
      expect(text).toContain('status')
      expect(text).toContain('threadId')

      await reader.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle cross-thread memory persistence', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()

    // Store information in thread 1
    const response1 = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant.' },
          { role: 'user', content: 'Remember that the sky is blue.' },
        ],
        threadId: threadId1,
      }),
    })

    expect(response1.status).toBe(200)
    const reader1 = response1.body?.getReader()
    if (reader1) {
      await reader1.read()
      await reader1.cancel()
    }

    // Try to access the information from thread 2
    const response2 = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'What color is the sky?' },
        ],
        threadId: threadId2,
      }),
    })

    expect(response2.status).toBe(200)
    const reader2 = response2.body?.getReader()
    if (reader2) {
      const { value } = await reader2.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('blue')
      await reader2.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle user interaction in chat', async () => {
    const threadId = uuidv4()
    const response = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant.' },
          { role: 'user', content: 'I need help with a task that requires user input.' },
        ],
        threadId,
        requireUserInput: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toContain('data:')
      expect(text).toContain('messages')
      expect(text).toContain('status')
      expect(text).toContain('threadId')
      expect(text).toContain('user_input')

      await reader.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)

  test('should handle XML-formatted responses', async () => {
    const threadId = uuidv4()
    const response = await fetch('http://localhost:3001/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: 'test.txt',
        prompt: 'Create a file with XML content',
        threadId,
      }),
    })

    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)

      expect(text).toMatch(/<response>[\s\S]*<\/response>/)
      expect(text).toMatch(/<edit>[\s\S]*<\/edit>/)
      expect(text).toMatch(/<file>[\s\S]*<\/file>/)
      expect(text).toMatch(/<content>[\s\S]*<\/content>/)

      await reader.cancel()
    }
  }, TEST_CONFIG.INTEGRATION_TEST_TIMEOUT)
})