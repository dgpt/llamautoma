import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint, task } from '@langchain/langgraph'
import { z } from 'zod'
import { createTestContext, waitForResponse, type TestContext } from '../utils'

// Schema for reviewer output
const ReviewSchema = z.object({
  passed: z.boolean(),
  feedback: z.array(
    z.object({
      type: z.enum(['error', 'warning', 'suggestion']),
      message: z.string(),
      location: z
        .object({
          file: z.string().optional(),
          line: z.number().optional(),
          column: z.number().optional(),
        })
        .optional(),
    })
  ),
  suggestions: z.array(z.string()).optional(),
  requires_changes: z.boolean(),
  max_iterations_reached: z.boolean().optional(),
})

describe('Reviewer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should approve a well-formed plan', async () => {
    const reviewerTask = task('reviewer', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'reviewer_test' },
      async (messages: BaseMessage[]) => {
        const result = await reviewerTask(messages)
        return result
      }
    )

    const plan = {
      plan: [
        {
          step: 1,
          description: 'Initialize new React project using create-react-app',
          tools: ['run_terminal_cmd'],
        },
        {
          step: 2,
          description: 'Create Counter component with TypeScript',
          tools: ['edit_file'],
        },
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code reviewer. Review this plan.'),
      new HumanMessage('Create a React counter component'),
      new SystemMessage(JSON.stringify(plan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const review = JSON.parse(result.content.toString())

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.passed).toBe(true)
    expect(review.requires_changes).toBe(false)
  })

  test('should reject a plan missing critical steps', async () => {
    const reviewerTask = task('reviewer', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'reviewer_test' },
      async (messages: BaseMessage[]) => {
        const result = await reviewerTask(messages)
        return result
      }
    )

    const incompletePlan = {
      plan: [
        {
          step: 1,
          description: 'Initialize new React project using create-react-app',
          tools: ['run_terminal_cmd'],
        },
        // Missing component creation and styling steps
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code reviewer. Review this plan.'),
      new HumanMessage('Create a styled React counter component with increment/decrement buttons'),
      new SystemMessage(JSON.stringify(incompletePlan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const review = JSON.parse(result.content.toString())

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.passed).toBe(false)
    expect(review.requires_changes).toBe(true)
    expect(
      review.feedback.some(
        (f: z.infer<typeof ReviewSchema>['feedback'][number]) =>
          f.type === 'error' && f.message.toLowerCase().includes('missing')
      )
    ).toBe(true)
  })

  test('should approve well-written code', async () => {
    const reviewerTask = task('reviewer', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'reviewer_test' },
      async (messages: BaseMessage[]) => {
        const result = await reviewerTask(messages)
        return result
      }
    )

    const code = `
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
};`

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component'),
      new SystemMessage(code),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const review = JSON.parse(result.content.toString())

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.passed).toBe(true)
    expect(review.requires_changes).toBe(false)
  })

  test('should reject code with potential issues', async () => {
    const reviewerTask = task('reviewer', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'reviewer_test' },
      async (messages: BaseMessage[]) => {
        const result = await reviewerTask(messages)
        return result
      }
    )

    const problematicCode = `
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
};`

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component that properly manages state'),
      new SystemMessage(problematicCode),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const review = JSON.parse(result.content.toString())

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.passed).toBe(false)
    expect(review.requires_changes).toBe(true)
    expect(
      review.feedback.some(
        (f: z.infer<typeof ReviewSchema>['feedback'][number]) =>
          f.type === 'error' && f.message.toLowerCase().includes('state')
      )
    ).toBe(true)
  })
})
