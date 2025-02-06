import { expect, test, describe } from 'bun:test'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { plannerTask } from '../../../src/ai/tasks/planner'
import { PlanSchema, type Plan } from 'llamautoma-types'
import { runWithTestConfig } from '../utils'

describe('Planner Task Tests', () => {
  test('should create plan for code request', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage(
        'Create a React counter component with TypeScript support. It should display the current count and have increment and decrement buttons.'
      ),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.response).toBeDefined()
    expect(result.steps).toBeDefined()
    expect(Array.isArray(result.steps)).toBe(true)
    expect(result.steps!.length).toBeGreaterThan(0)
  })

  test('should incorporate feedback into plan', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a user registration form'),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
      feedback: {
        approved: false,
        feedback: 'Add password validation and error handling',
      },
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.response).toBeDefined()
    expect(result.steps).toBeDefined()
    expect(Array.isArray(result.steps)).toBe(true)
    expect(result.steps!.length).toBeGreaterThan(0)
  })
})
