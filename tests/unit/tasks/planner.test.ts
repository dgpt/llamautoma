import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { plannerTask } from '@/ai/tasks/planner'
import { PlanSchema, type Plan } from 'llamautoma-types'

describe('Planner Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should create plan for code request', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'planner_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await plannerTask({
          messages,
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
          checkpoint_ns: 'planner_test',
        },
      })
    )
    const plan = result as Plan

    expect(() => PlanSchema.parse(plan)).not.toThrow()
    expect(plan.response).toBeDefined()
    expect(plan.steps).toBeDefined()
    expect(Array.isArray(plan.steps)).toBe(true)
    expect(plan.steps!.length).toBeGreaterThan(0)
  })

  test('should incorporate review feedback into plan', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'planner_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await plannerTask({
          messages,
          review: {
            approved: false,
            feedback: 'Add password validation and error handling',
            suggestions: [
              {
                step: 'Add password validation',
                action: 'Implement password strength requirements and validation',
              },
              {
                step: 'Add error handling',
                action: 'Add proper error handling for form submission and validation',
              },
            ],
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a user registration form'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'planner_test',
        },
      })
    )
    const plan = result as Plan

    expect(() => PlanSchema.parse(plan)).not.toThrow()
    expect(plan.response).toBeDefined()
    expect(plan.steps).toBeDefined()
    expect(Array.isArray(plan.steps)).toBe(true)
    expect(plan.steps!.length).toBeGreaterThan(0)
  })
})
