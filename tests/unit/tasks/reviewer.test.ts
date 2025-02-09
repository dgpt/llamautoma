import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, TEST_TIMEOUT, type TestContext } from '../utils'
import { reviewerTask } from '@/ai/tasks/reviewer'
import { ReviewerTaskSchema, type ReviewerTaskOutput } from '@/ai/tasks/schemas/tasks'

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
        expect(review.suggestions[0]).toHaveProperty('priority')
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
        expect(review.suggestions[0]).toHaveProperty('priority')
      }
    },
    TEST_TIMEOUT
  )
})
