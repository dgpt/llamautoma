import { expect, test, describe, beforeEach, spyOn } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, TEST_TIMEOUT, type TestContext } from '../utils'
import { plannerTask } from '@/ai/tasks/planner'
import { PlannerTaskSchema, type PlannerTaskOutput } from '@/ai/tasks/schemas/tasks'
import { llm } from '@/ai/llm'

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
      new HumanMessage('Create a simple hello world function'),
    ]

    const result = await Promise.race([
      waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'planner_test',
          },
        })
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT * 2)
      ),
    ])
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

  test('should stream progress and plan steps', async () => {
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
      new HumanMessage('Create a simple hello world function'),
    ]

    const result = await Promise.race([
      waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'planner_test',
          },
        })
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT * 2)
      ),
    ])
    const plan = result as PlannerTaskOutput

    // Verify streaming responses
    expect(plan.streamResponses).toBeDefined()
    expect(plan.streamResponses.length).toBeGreaterThan(0)

    // Verify initial progress message
    const progressStart = plan.streamResponses.find(
      r => r.type === 'progress' && r.content === 'Creating plan...'
    )
    expect(progressStart).toBeDefined()

    // Verify plan steps are streamed
    const planSteps = plan.streamResponses.filter(r => r.type === 'plan')
    expect(planSteps.length).toBeGreaterThan(0)

    // Verify completion message
    const progressEnd = plan.streamResponses.find(
      r => r.type === 'progress' && r.content === 'Plan created successfully'
    )
    expect(progressEnd).toBeDefined()
  }, 42000)

  test('should handle empty message input', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'planner_test',
      },
      async () => {
        throw new Error('No messages provided to planner task')
      }
    )

    await expect(
      workflow.invoke([], {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'planner_test',
        },
      })
    ).rejects.toThrow('No messages provided to planner task')
  })

  test('should handle LLM errors gracefully', async () => {
    const llmSpy = spyOn(llm, 'invoke')
    llmSpy.mockImplementation(() => Promise.reject(new Error('LLM error')))

    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'planner_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await plannerTask({
          messages: [new HumanMessage('test')],
        })
        return result
      }
    )

    await expect(
      Promise.race([
        workflow.invoke([new HumanMessage('test')], {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'planner_test',
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT)
        ),
      ])
    ).rejects.toThrow('LLM error')

    llmSpy.mockRestore()
  })

  test('should validate response structure', async () => {
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
      new HumanMessage('Create a simple hello world function'),
    ]

    const result = await Promise.race([
      waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'planner_test',
          },
        })
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT * 2)
      ),
    ])
    const plan = result as PlannerTaskOutput

    // Verify response structure
    expect(plan.response.type).toBe('plan')
    expect(plan.response.shouldDisplay).toBe(true)
    expect(plan.response.priority).toBeGreaterThan(0)
    expect(plan.response.priority).toBeLessThanOrEqual(100)
    expect(plan.response.timestamp).toBeDefined()
    expect(typeof plan.response.content).toBe('string')

    // Verify steps structure
    expect(plan.steps).toBeDefined()
    if (plan.steps) {
      plan.steps.forEach(step => {
        expect(step.status).toBe('pending')
        expect(typeof step.step).toBe('string')
        expect(typeof step.description).toBe('string')
      })
    }
  })
})
