import { expect, test, describe, beforeEach } from 'bun:test'
import { llamautoma } from '@/ai'
import { llm } from '@/ai/llm'
import type { Message, WorkflowState, BaseResponse } from 'llamautoma-types'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { createTestContext, waitForResponse, type TestContext } from '../unit/utils'

describe('AI Workflow Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should handle chat responses when plan indicates no task', async () => {
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

    const result = await waitForResponse(llamautoma.invoke(input))

    // Validate response structure for chat
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.response).toBeDefined()
    expect(result.metadata?.diffs).toBeUndefined() // Chat responses don't have diffs
  })

  test('should handle code generation workflow', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code generation assistant.' },
      { role: 'user', content: 'Create a React counter component with TypeScript support.' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    const result = await waitForResponse(llamautoma.invoke(input))

    // Validate response structure for code generation
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.diffs).toBeDefined()
    expect(result.metadata?.type).toBe('code')
    expect(result.metadata?.plan).toBeDefined()
    expect(result.metadata?.planIterations).toBeDefined()
    expect(result.metadata?.codeIterations).toBeDefined()
  })

  test('should support streaming responses', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code generation assistant.' },
      { role: 'user', content: 'Create a React counter component with TypeScript support.' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    const stream = await llamautoma.stream(input)

    const chunks: BaseResponse[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // Validate final chunk has complete response
    const finalChunk = chunks[chunks.length - 1]
    expect(finalChunk).toBeDefined()
    expect(finalChunk.metadata).toBeDefined()
    expect(finalChunk.status).toBe('success')
  })

  test('should handle context summarization', async () => {
    // Create system messages that should be preserved
    const systemMessages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'system', content: 'You should follow these guidelines: ...' },
    ]

    // Create a long conversation that should exceed token limit
    const conversationMessages: Message[] = Array(15)
      .fill(null)
      .map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        // Use longer messages to ensure we hit token limit
        content: `${'This is message number ' + (i + 1) + '. '.repeat(50)}`,
      }))

    const messages = [...systemMessages, ...conversationMessages]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
      config: {
        modelName: DEFAULT_CONFIG.modelName,
        memory: {
          maxContextTokens: 1024, // Set low token limit to trigger summarization
          pruneThreshold: 768,
        },
      },
    }

    const result = await waitForResponse(llamautoma.invoke(input))

    // Validate response after summarization
    expect(result).toBeDefined()
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.messages).toBeDefined()

    // Verify system messages are preserved
    const resultSystemMessages = result.metadata!.messages.filter(
      (msg: Message) => msg.role === 'system'
    )
    expect(resultSystemMessages).toHaveLength(systemMessages.length)
    expect(resultSystemMessages).toEqual(systemMessages)

    // Get token counts for original and summarized messages
    const originalTokens = await Promise.all(
      messages.map((msg: Message) => llm.getNumTokens(msg.content))
    )
    const summarizedTokens = await Promise.all(
      result.metadata!.messages.map((msg: Message) => llm.getNumTokens(msg.content))
    )

    const totalOriginalTokens = originalTokens.reduce(
      (sum: number, count: number) => sum + count,
      0
    )
    const totalSummarizedTokens = summarizedTokens.reduce(
      (sum: number, count: number) => sum + count,
      0
    )

    // Verify summarization reduced token count while preserving system messages
    expect(totalSummarizedTokens).toBeLessThan(totalOriginalTokens)
    expect(totalSummarizedTokens).toBeLessThanOrEqual(1024) // Should be under maxContextTokens
  })

  test('should handle errors gracefully', async () => {
    const messages: Message[] = [] // Empty messages array should trigger error

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    const result = await waitForResponse(llamautoma.invoke(input))

    // Validate error response
    expect(result).toBeDefined()
    expect(result.status).toBe('error')
    expect(result.error).toBeDefined()
  })
})
