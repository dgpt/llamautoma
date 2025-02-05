import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createTestContext, type TestContext } from '../unit/utils'
import { createWorkflow } from '@/ai'
import { PlanSchema, CodeSchema } from 'llamautoma-types'

describe('Evaluator-Optimizer Workflow Integration Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should complete full workflow for code generation request', async () => {
    const workflow = await createWorkflow(ctx.chatModel)
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a simple TypeScript function to calculate fibonacci numbers.'),
    ]

    const stream = await workflow.stream({ messages, configurable: { thread_id: ctx.threadId } })
    const steps: any[] = []

    for await (const step of stream) {
      steps.push(step)

      // Verify each step has required properties
      expect(step).toHaveProperty('status')
      expect(step).toHaveProperty('metadata')

      // Verify step transitions
      if (step.status === 'planning') {
        expect(() => PlanSchema.parse(step.metadata.plan)).not.toThrow()
      } else if (step.status === 'coding') {
        expect(() => CodeSchema.parse(step.metadata.code)).not.toThrow()
      }
    }

    // Verify workflow progression
    expect(steps.some(s => s.status === 'planning')).toBe(true)
    expect(steps.some(s => s.status === 'coding')).toBe(true)
    expect(steps.some(s => s.status === 'reviewing')).toBe(true)
    expect(steps.some(s => s.status === 'complete')).toBe(true)

    // Verify final result
    const finalStep = steps[steps.length - 1]
    expect(finalStep.status).toBe('complete')
    expect(finalStep.metadata.code.files).toBeInstanceOf(Array)
    expect(finalStep.metadata.code.files.length).toBeGreaterThan(0)
  })

  test('should handle feedback and optimization cycles', async () => {
    const workflow = await createWorkflow(ctx.chatModel)
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a React button component.'),
    ]

    // First pass
    const stream1 = await workflow.stream({ messages, configurable: { thread_id: ctx.threadId } })
    const steps1: any[] = []
    for await (const step of stream1) steps1.push(step)

    // Add feedback and run second pass
    const feedback = {
      approved: false,
      feedback: 'Add TypeScript types and accessibility attributes.',
    }

    const stream2 = await workflow.stream({
      messages: [...messages, new SystemMessage(`Previous feedback: ${feedback.feedback}`)],
      feedback,
      configurable: { thread_id: ctx.threadId },
    })

    const steps2: any[] = []
    for await (const step of stream2) steps2.push(step)

    // Verify optimization occurred
    const finalCode1 = steps1[steps1.length - 1].metadata.code
    const finalCode2 = steps2[steps2.length - 1].metadata.code
    expect(finalCode2.files).not.toEqual(finalCode1.files)

    // Verify TypeScript and accessibility improvements
    const buttonCode = finalCode2.files.find((f: any) => f.path.includes('Button'))
    expect(buttonCode.content).toMatch(/interface|type|Props/i)
    expect(buttonCode.content).toMatch(/aria-|role=/i)
  })

  test('should maintain consistent state across steps', async () => {
    const workflow = await createWorkflow(ctx.chatModel)
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a TypeScript utility for deep object comparison.'),
    ]

    const stream = await workflow.stream({ messages, configurable: { thread_id: ctx.threadId } })
    let previousPlan: any = null
    let previousCode: any = null

    for await (const step of stream) {
      if (step.status === 'planning') {
        if (previousPlan) {
          // Verify plan consistency
          expect(step.metadata.plan.type).toBe(previousPlan.type)
          expect(step.metadata.plan.steps.length).toBeGreaterThanOrEqual(previousPlan.steps.length)
        }
        previousPlan = step.metadata.plan
      } else if (step.status === 'coding') {
        if (previousCode) {
          // Verify code consistency
          expect(step.metadata.code.files.length).toBeGreaterThanOrEqual(previousCode.files.length)
        }
        previousCode = step.metadata.code
      }
    }
  })
})
