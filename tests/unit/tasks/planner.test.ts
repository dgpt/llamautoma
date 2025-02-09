import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { plannerTask } from '@/ai/tasks/planner'
import { PlannerTaskSchema, type PlannerTaskOutput } from '@/ai/tasks/schemas/tasks'

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
    const plan = result as PlannerTaskOutput

    expect(() => PlannerTaskSchema.parse(plan)).not.toThrow()
    expect(plan.response).toBeDefined()
    expect(plan.plan).toBeDefined()
    expect(plan.steps).toBeDefined()
    if (plan.steps) {
      expect(Array.isArray(plan.steps)).toBe(true)
      expect(plan.steps.length).toBeGreaterThan(0)
      expect(plan.steps[0]).toHaveProperty('step')
      expect(plan.steps[0]).toHaveProperty('description')
      expect(plan.steps[0]).toHaveProperty('status')
    }
  })

  test('should handle complex code generation request', async () => {
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
        'Create a user registration form with password validation and error handling. Include proper form submission handling and validation feedback.'
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
    const plan = result as PlannerTaskOutput

    expect(() => PlannerTaskSchema.parse(plan)).not.toThrow()
    expect(plan.response).toBeDefined()
    expect(plan.plan).toBeDefined()
    expect(plan.steps).toBeDefined()
    if (plan.steps) {
      expect(Array.isArray(plan.steps)).toBe(true)
      expect(plan.steps.length).toBeGreaterThan(0)
      expect(plan.steps[0]).toHaveProperty('step')
      expect(plan.steps[0]).toHaveProperty('description')
      expect(plan.steps[0]).toHaveProperty('status')
    }
  })
})
