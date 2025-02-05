import { expect, test, describe } from 'bun:test'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { plannerTask } from '../../../src/ai/tasks/planner'
import { PlanSchema, type Plan } from 'llamautoma-types'
import { runWithTestConfig } from '../utils'

describe('Planner Task Tests', () => {
  test('should create a valid plan for a clear request', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a React counter component with TypeScript support.'),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.type).toBe('code')
  })

  test('should request clarification for vague requests', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Make it better.'),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.type).toBe('chat')
    expect(result.steps).toContain('Request clarification from user')
  })

  test('should handle multi-step tasks with tool requirements', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a full-stack web app with React frontend and Node.js backend.'),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.steps.length).toBeGreaterThan(2)
    expect(result.tools?.length).toBeGreaterThan(0)
  })

  test('should maintain context across plan revisions', async () => {
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a React counter component.'),
      new SystemMessage('Previous feedback: Add TypeScript support and error handling.'),
    ]

    const result = await runWithTestConfig<Plan>(plannerTask, {
      messages,
      feedback: {
        approved: false,
        feedback: 'Add TypeScript support and error handling',
      },
    })

    expect(() => PlanSchema.parse(result)).not.toThrow()
    expect(result.steps.some((step: string) => step.toLowerCase().includes('typescript'))).toBe(
      true
    )
    expect(result.steps.some((step: string) => step.toLowerCase().includes('error'))).toBe(true)
  })
})
