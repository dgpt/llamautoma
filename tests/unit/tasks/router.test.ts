import { expect, test, describe, beforeEach } from 'bun:test'
import { llamautoma } from '@/ai/tasks/router'
import type { Message, WorkflowState, BaseResponse } from 'llamautoma-types'
import {
  createTestContext,
  waitForResponse,
  validateStreamChunks,
  type TestContext,
} from '../utils'

describe('Router Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should route code generation request to coder task', async () => {
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

    // Validate response structure
    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.type).toBe('code')
    expect(result.metadata?.threadId).toBe(ctx.threadId)
  })

  test('should route review request to reviewer task', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code review assistant.' },
      { role: 'user', content: 'Review this code for security issues.' },
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    const result = await waitForResponse(llamautoma.invoke(input))

    expect(result.status).toBe('success')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.type).toBe('code')
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

    validateStreamChunks(chunks)
  })

  test('should handle errors gracefully', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a code generation assistant.' },
      { role: 'user', content: '' }, // Empty message should trigger error
    ]

    const input: WorkflowState = {
      id: ctx.threadId,
      messages,
      status: 'pending',
      metadata: { checkpoint: 'test' },
    }

    try {
      await llamautoma.invoke(input)
      throw new Error('Should have thrown an error')
    } catch (error) {
      expect(error).toBeDefined()
      expect((error as Error).message).toContain('empty message')
    }
  })
})
