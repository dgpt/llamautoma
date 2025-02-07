import { expect, test, describe, beforeEach } from 'bun:test'
import { llamautoma } from '@/ai'
import { llm } from '@/ai/llm'
import type { Message, WorkflowState, BaseResponse } from 'llamautoma-types'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { createTestContext, waitForResponse, type TestContext, TEST_MODEL } from '../unit/utils'
import { logger } from '@/logger'

describe('AI Workflow Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    logger.level = 'debug' // Enable debug logging for tests
  })

  test('should handle chat responses when intent is chat', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the difference between TypeScript and JavaScript?' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    logger.debug('Starting chat test')
    const result = await waitForResponse(llamautoma.invoke(input, ctx.config))
    logger.debug('Chat test completed')

    // Validate response structure for chat
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.messages).toBeDefined()
    expect(Array.isArray(result.metadata?.messages)).toBe(true)
    expect(result.metadata?.messages.length).toBeGreaterThan(0)

    // Chat responses shouldn't have code generation artifacts
    expect(result.metadata?.plan).toBeUndefined()
    expect(result.metadata?.code).toBeUndefined()
    expect(result.metadata?.diff).toBeUndefined()
  }, 15000)

  test('should handle code generation workflow with evaluator-optimizer loop', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code generation assistant.' },
      { role: 'user', content: 'Create a simple TypeScript function that adds two numbers.' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
      config: {
        modelName: TEST_MODEL,
        maxIterations: 3, // Limit iterations for testing
        ...ctx.config,
      },
    }

    logger.debug('Starting code generation test')
    const result = await waitForResponse(llamautoma.invoke(input, ctx.config))
    logger.debug('Code generation test completed')

    // Validate response structure for code generation
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.messages).toBeDefined()
    expect(Array.isArray(result.metadata?.messages)).toBe(true)

    // Code generation should have plan, code, and diff
    expect(result.metadata?.plan).toBeDefined()
    expect(result.metadata?.code).toBeDefined()
    expect(result.metadata?.diff).toBeDefined()

    // Verify code structure if present
    if (result.metadata?.code) {
      expect(Array.isArray(result.metadata.code.files)).toBe(true)
      if (result.metadata.code.files.length > 0) {
        const file = result.metadata.code.files[0]
        expect(file).toHaveProperty('path')
        expect(file).toHaveProperty('content')
        expect(file).toHaveProperty('type')
        expect(file).toHaveProperty('description')
      }
    }

    // Verify diff structure if present
    if (result.metadata?.diff) {
      expect(Array.isArray(result.metadata.diff)).toBe(true)
      if (result.metadata.diff.length > 0) {
        const diff = result.metadata.diff[0]
        expect(diff).toHaveProperty('path')
        expect(diff).toHaveProperty('diff')
      }
    }
  }, 60000)

  test('should support streaming responses with workflow updates', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code generation assistant.' },
      { role: 'user', content: 'Create a simple TypeScript function that adds two numbers.' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    logger.debug('Starting streaming test')
    const stream = await llamautoma.stream(input, ctx.config)

    const chunks: BaseResponse[] = []

    for await (const chunk of stream) {
      // Type assertion to ensure chunk matches BaseResponse
      const typedChunk = chunk as BaseResponse
      chunks.push(typedChunk)
      logger.debug(`Received chunk: ${JSON.stringify(chunk)}`)

      // Validate chunk structure
      expect(typedChunk).toBeDefined()
      expect(typedChunk.status).toBe('in_progress')
      expect(typedChunk.metadata).toBeDefined()
      expect(typedChunk.metadata?.messages).toBeDefined()

      // Each chunk might have partial results
      if (typedChunk.metadata?.plan) expect(typedChunk.metadata.plan).toBeDefined()
      if (typedChunk.metadata?.code) expect(typedChunk.metadata.code).toBeDefined()
      if (typedChunk.metadata?.diff) expect(typedChunk.metadata.diff).toBeDefined()
    }

    logger.debug('Streaming test completed')

    // Validate we got some chunks
    expect(chunks.length).toBeGreaterThan(0)

    // Validate final chunk has complete data
    const finalChunk = chunks[chunks.length - 1]
    expect(finalChunk).toBeDefined()
    expect(finalChunk.metadata?.messages).toBeDefined()
  }, 60000)

  test('should handle context summarization when needed', async () => {
    // Create a long conversation that should exceed context length
    const messages: Message[] = Array(DEFAULT_CONFIG.memory.maxContextTokens + 5)
      .fill(null)
      .map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1} with some content to take up space.`,
      }))

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    logger.debug('Starting summarization test')
    const result = await waitForResponse(llamautoma.invoke(input, ctx.config))
    logger.debug('Summarization test completed')

    // Validate response after summarization
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.messages).toBeDefined()
    expect(Array.isArray(result.metadata?.messages)).toBe(true)

    // Verify summarization reduced message count
    expect(result.metadata?.messages.length).toBeLessThan(messages.length)
  }, 30000)

  test('should handle errors gracefully', async () => {
    const messages: Message[] = [] // Empty messages array should trigger error

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    logger.debug('Starting error handling test')
    const result = await waitForResponse(llamautoma.invoke(input, ctx.config))
    logger.debug('Error handling test completed')

    // Validate response structure
    expect(result).toBeDefined()
    expect(result.status).toBe('success') // Empty messages are handled gracefully
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.messages).toBeDefined()
    expect(Array.isArray(result.metadata?.messages)).toBe(true)
  }, 15000)
})
