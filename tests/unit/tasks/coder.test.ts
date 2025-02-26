import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, TEST_TIMEOUT, type TestContext } from '../utils'
import { coderTask } from '@/ai/tasks/coder'
import {
  CoderTaskSchema,
  type CoderTaskOutput,
  type ReviewerTaskOutput,
} from '@/ai/tasks/schemas/tasks'

interface Plan {
  response: string
  steps: string[]
}

describe('Coder Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test(
    'should generate Python code',
    async () => {
      const workflow = entrypoint(
        {
          checkpointer: ctx.memorySaver,
          name: 'coder_test',
        },
        async (messages: BaseMessage[]) => {
          const plan = {
            response: 'Create a FastAPI endpoint for user registration',
            steps: [
              'Create FastAPI app',
              'Define user model with Pydantic',
              'Add registration endpoint',
              'Add input validation',
              'Add database integration',
            ],
          }
          const result = await coderTask({
            messages,
            plan: plan.steps.join('\n'),
          })
          return result
        }
      )

      const messages = [
        new SystemMessage('You are a code generator.'),
        new HumanMessage('Create a FastAPI endpoint for user registration with SQLAlchemy'),
      ]

      const result = await waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'coder_test',
          },
        })
      )
      const generated = result as CoderTaskOutput

      expect(() => CoderTaskSchema.parse(generated)).not.toThrow()
      expect(generated.files).toBeDefined()
      expect(generated.files.length).toBeGreaterThan(0)
      expect(generated.response).toBeDefined()
      expect(generated.streamResponses).toBeDefined()
    },
    TEST_TIMEOUT
  )

  test(
    'should generate JavaScript/React code',
    async () => {
      const workflow = entrypoint(
        {
          checkpointer: ctx.memorySaver,
          name: 'coder_test',
        },
        async (messages: BaseMessage[]) => {
          const plan = {
            response: 'Create a React counter component',
            steps: [
              'Create component file',
              'Add state management',
              'Add increment/decrement functions',
              'Create component structure',
              'Add styling',
            ],
          }
          const result = await coderTask({
            messages,
            plan: plan.steps.join('\n'),
          })
          return result
        }
      )

      const messages = [
        new SystemMessage('You are a code generator.'),
        new HumanMessage('Create a React counter component with styled-components'),
      ]

      const result = await waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'coder_test',
          },
        })
      )
      const generated = result as CoderTaskOutput

      expect(() => CoderTaskSchema.parse(generated)).not.toThrow()
      expect(generated.dependencies).toBeDefined()
      expect(generated.dependencies?.length).toBeGreaterThan(0)
      expect(generated.files).toBeDefined()
      expect(generated.files.length).toBeGreaterThan(0)
      expect(generated.response).toBeDefined()
      expect(generated.streamResponses).toBeDefined()
    },
    TEST_TIMEOUT
  )

  test(
    'should handle review feedback and improve code',
    async () => {
      const workflow = entrypoint(
        {
          checkpointer: ctx.memorySaver,
          name: 'coder_test',
        },
        async (messages: BaseMessage[]) => {
          const plan = {
            response: 'Create a Go HTTP server',
            steps: [
              'Create main package',
              'Add router setup',
              'Add health check endpoint',
              'Add logging middleware',
              'Add graceful shutdown',
            ],
          }
          const result = await coderTask({
            messages,
            plan: plan.steps.join('\n'),
            review: {
              response: {
                type: 'review',
                content: 'Add proper error handling and logging',
                shouldDisplay: true,
                timestamp: Date.now(),
              },
              streamResponses: [],
              approved: false,
              feedback: 'Add proper error handling and logging',
              suggestions: [
                {
                  step: 'Add router setup',
                  action: 'Include error middleware and panic recovery',
                },
                {
                  step: 'Add logging middleware',
                  action: 'Use structured logging with proper levels and request tracing',
                },
              ],
            } as ReviewerTaskOutput,
          })
          return result
        }
      )

      const messages = [
        new SystemMessage('You are a code generator.'),
        new HumanMessage('Create a Go HTTP server with proper error handling'),
      ]

      const result = await waitForResponse(
        workflow.invoke(messages, {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'coder_test',
          },
        })
      )
      const generated = result as CoderTaskOutput

      expect(() => CoderTaskSchema.parse(generated)).not.toThrow()
      expect(generated.files).toBeDefined()
      expect(generated.files.length).toBeGreaterThan(0)
      expect(generated.response).toBeDefined()
      expect(generated.streamResponses).toBeDefined()
    },
    TEST_TIMEOUT
  )
})
