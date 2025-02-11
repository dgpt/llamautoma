import { expect, test, describe, spyOn, beforeEach, afterEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import {
  createTestContext,
  waitForResponse,
  TEST_TIMEOUT,
  type TestContext,
  runWithTestConfig,
} from '../utils'
import { reviewerTask } from '@/ai/tasks/reviewer'
import { ReviewerTaskSchema, type ReviewerTaskOutput } from '@/ai/tasks/schemas/tasks'
import { llm } from '@/ai/llm'
import * as stream from '@/stream'

// Declare spies at the outer scope
let broadcastSpy: ReturnType<typeof spyOn>
let llmSpy: ReturnType<typeof spyOn>

// Setup and teardown for all tests
beforeEach(() => {
  broadcastSpy = spyOn(stream, 'broadcast')
  llmSpy = spyOn(llm, 'invoke')
})

afterEach(() => {
  broadcastSpy.mockRestore()
  llmSpy.mockRestore()
})

describe('Reviewer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test(
    'should review code generation plan',
    async () => {
      const workflow = entrypoint(
        {
          checkpointer: ctx.memorySaver,
          name: 'reviewer_test',
        },
        async (messages: BaseMessage[]) => {
          const result = await reviewerTask({
            messages,
            files: {
              'plan.md': `1. Create React component file
2. Add state management
3. Implement increment/decrement functions
4. Add styling`,
            },
          })
          return result
        }
      )

      const messages = [
        new SystemMessage('You are a code generation assistant.'),
        new HumanMessage(
          'Create a React counter component with TypeScript support. It should display the current count and have increment and decrement buttons.'
        ),
      ]

      const result = await waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'reviewer_test',
          },
        })
      )
      const review = result as ReviewerTaskOutput

      expect(() => ReviewerTaskSchema.parse(review)).not.toThrow()
      expect(review.response).toBeDefined()
      expect(review.approved).toBeDefined()
      expect(review.feedback).toBeDefined()
      expect(review.suggestions).toBeDefined()
      expect(Array.isArray(review.suggestions)).toBe(true)
      if (review.suggestions) {
        expect(review.suggestions[0]).toHaveProperty('step')
        expect(review.suggestions[0]).toHaveProperty('action')
      }
    },
    TEST_TIMEOUT
  )

  test(
    'should review code implementation',
    async () => {
      const workflow = entrypoint(
        {
          checkpointer: ctx.memorySaver,
          name: 'reviewer_test',
        },
        async (messages: BaseMessage[]) => {
          const result = await reviewerTask({
            messages,
            files: {
              'src/components/Counter.tsx': `
import React, { useState } from 'react'

export const Counter: React.FC = () => {
  const [count, setCount] = useState(0)

  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>+</button>
      <button onClick={() => setCount(count - 1)}>-</button>
    </div>
  )
}`,
            },
          })
          return result
        }
      )

      const messages = [
        new SystemMessage('You are a code generation assistant.'),
        new HumanMessage(
          'Create a React counter component with TypeScript support. It should display the current count and have increment and decrement buttons.'
        ),
      ]

      const result = await waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'reviewer_test',
          },
        })
      )
      const review = result as ReviewerTaskOutput

      expect(() => ReviewerTaskSchema.parse(review)).not.toThrow()
      expect(review.response).toBeDefined()
      expect(review.approved).toBeDefined()
      expect(review.feedback).toBeDefined()
      expect(review.suggestions).toBeDefined()
      expect(Array.isArray(review.suggestions)).toBe(true)
      if (review.suggestions) {
        expect(review.suggestions[0]).toHaveProperty('step')
        expect(review.suggestions[0]).toHaveProperty('action')
      }
    },
    TEST_TIMEOUT
  )
})

describe('Reviewer Task', () => {
  test(
    'should handle empty files object',
    async () => {
      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [],
        files: {},
      })

      expect(result.approved).toBe(false)
      expect(result.feedback).toBe('No files provided for review.')
      expect(result.suggestions).toEqual([])
      expect(result.metrics).toEqual({
        quality: 0,
        coverage: 0,
        complexity: 0,
      })
      expect(broadcastSpy).toHaveBeenCalledWith('Reviewing code...', 'progress')
    },
    TEST_TIMEOUT
  )

  test(
    'should handle valid files and approved review',
    async () => {
      const mockResponse = {
        content: `APPROVED

Security: Add input validation
Style: Add consistent spacing

Code Quality: Good structure and readability
Error Handling: Needs improvement`,
      }

      llmSpy.mockImplementation(() => Promise.resolve(mockResponse))

      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [new HumanMessage('Test message')],
        files: {
          'test.ts': 'console.log("test")',
        },
      })

      expect(result.approved).toBe(true)
      expect(result.feedback).toBeTruthy()
      expect(result.suggestions?.length).toBeGreaterThan(0)
      expect(broadcastSpy).toHaveBeenCalledWith('Review approved', 'chat')
    },
    TEST_TIMEOUT
  )

  test(
    'should handle valid files and rejected review',
    async () => {
      const mockResponse = {
        content: `REJECTED

Security: Fix SQL injection vulnerability
Documentation: Add JSDoc comments`,
      }

      llmSpy.mockImplementation(() => Promise.resolve(mockResponse))

      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [new HumanMessage('Test message')],
        files: {
          'test.ts': 'const query = `SELECT * FROM users WHERE id = ${id}`',
        },
      })

      expect(result.approved).toBe(false)
      expect(result.feedback).toBeTruthy()
      expect(result.suggestions?.length).toBe(2)
      expect(broadcastSpy).toHaveBeenCalledWith('Review rejected', 'chat')
    },
    TEST_TIMEOUT
  )

  test(
    'should handle non-string LLM response content',
    async () => {
      const mockResponse = {
        content: { text: 'APPROVED\n\nTesting: Add unit tests' },
      }

      llmSpy.mockImplementation(() => Promise.resolve(mockResponse))

      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [new HumanMessage('Test message')],
        files: {
          'test.ts': 'function add(a, b) { return a + b }',
        },
      })

      expect(result.approved).toBe(true)
      expect(result.feedback).toBeTruthy()
      expect(result.suggestions?.length).toBe(1)
      expect(result.suggestions?.[0]).toEqual({
        step: 'Testing',
        action: 'Add unit tests',
      })
    },
    TEST_TIMEOUT
  )
})

describe('extractSuggestions', () => {
  test(
    'should handle empty feedback',
    async () => {
      const mockResponse = {
        content: '',
      }

      llmSpy.mockImplementation(() => Promise.resolve(mockResponse))

      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [],
        files: {
          'test.ts': 'console.log("test")',
        },
      })

      expect(result.suggestions).toEqual([])
    },
    TEST_TIMEOUT
  )

  test(
    'should parse suggestions',
    async () => {
      const mockResponse = {
        content: `APPROVED

Security: Add authentication
Style: Format code
Performance: Optimize database queries`,
      }

      llmSpy.mockImplementation(() => Promise.resolve(mockResponse))

      const result = await runWithTestConfig<ReviewerTaskOutput>(reviewerTask, {
        messages: [],
        files: {
          'test.ts': 'console.log("test")',
        },
      })

      expect(result.suggestions?.length).toBe(3)
      expect(result.suggestions).toContainEqual({
        step: 'Security',
        action: 'Add authentication',
      })
      expect(result.suggestions).toContainEqual({
        step: 'Style',
        action: 'Format code',
      })
      expect(result.suggestions).toContainEqual({
        step: 'Performance',
        action: 'Optimize database queries',
      })
    },
    TEST_TIMEOUT
  )
})
