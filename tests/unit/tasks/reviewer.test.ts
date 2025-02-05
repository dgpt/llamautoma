import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { reviewerTask } from '@/ai/tasks/reviewer'
import { ReviewSchema, type Review, type Plan, type GeneratedCode } from 'llamautoma-types'

describe('Reviewer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should review a plan thoroughly', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const plan: Plan = {
          type: 'code',
          steps: [
            'Initialize new React project using create-react-app',
            'Create Counter component with TypeScript',
          ],
        }
        const result = await reviewerTask({
          messages,
          plan,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this plan.'),
      new HumanMessage('Create a React counter component'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.feedback).toBeDefined()
    expect(review.suggestions).toBeDefined()
    expect(review.metadata).toBeDefined()
  })

  test('should reject an incomplete plan', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const plan: Plan = {
          type: 'code',
          steps: ['Initialize new React project using create-react-app'],
        }
        const result = await reviewerTask({
          messages,
          plan,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this plan.'),
      new HumanMessage('Create a styled React counter component with increment/decrement buttons'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(false)
    expect(review.feedback).toBeDefined()
    expect(
      review.feedback.toLowerCase().includes('missing') ||
        review.feedback.toLowerCase().includes('incomplete')
    ).toBe(true)
  })

  test('should approve well-written code', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const code: GeneratedCode = {
          files: [
            {
              path: 'src/components/Counter.tsx',
              content: `
import React, { useState } from 'react';

interface CounterProps {
  initialValue?: number;
}

export const Counter: React.FC<CounterProps> = ({ initialValue = 0 }) => {
  const [count, setCount] = useState(initialValue);

  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);

  return (
    <div className="counter">
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`,
            },
          ],
        }
        const result = await reviewerTask({
          messages,
          code,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(true)
    expect(review.feedback).toBeDefined()
  })

  test('should reject code with potential issues', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const code: GeneratedCode = {
          files: [
            {
              path: 'src/components/Counter.tsx',
              content: `
import React from 'react';

export const Counter = () => {
  let count = 0;  // Using let instead of useState

  const increment = () => count++;  // Direct mutation
  const decrement = () => count--;  // Direct mutation

  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`,
            },
          ],
        }
        const result = await reviewerTask({
          messages,
          code,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component that properly manages state'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(false)
    expect(review.feedback).toBeDefined()
    expect(review.feedback.toLowerCase()).toContain('state')
  })
})
