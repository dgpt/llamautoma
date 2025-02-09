import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { summarizerTask } from '@/ai/tasks/summarizer'
import { SummarizerTaskSchema, type SummarizerTaskOutput } from '@/ai/tasks/schemas/tasks'

describe('Summarizer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should summarize conversation', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
          maxContextTokens: 1000,
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a React counter component.'),
      new SystemMessage('I will help you create a React counter component.'),
      new HumanMessage('Can you add TypeScript support?'),
      new SystemMessage('Yes, I will add TypeScript support.'),
      new HumanMessage('Please add increment and decrement buttons.'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'summarizer_test',
        },
      })
    )
    const summary = result as SummarizerTaskOutput

    expect(() => SummarizerTaskSchema.parse(summary)).not.toThrow()
    expect(summary.response).toBeDefined()
    expect(summary.summary).toBeDefined()
    expect(summary.messages).toBeDefined()
    expect(Array.isArray(summary.messages)).toBe(true)
    expect(summary.messages.length).toBeGreaterThan(0)
  })

  test('should handle empty conversation', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages: [],
          maxContextTokens: 1000,
        })
        return result
      }
    )

    const result = await waitForResponse(
      workflow.invoke([], {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'summarizer_test',
        },
      })
    )
    const summary = result as SummarizerTaskOutput

    expect(() => SummarizerTaskSchema.parse(summary)).not.toThrow()
    expect(summary.response).toBeDefined()
    expect(summary.summary).toBeDefined()
    expect(summary.messages).toBeDefined()
    expect(Array.isArray(summary.messages)).toBe(true)
    expect(summary.messages.length).toBe(0)
  })
})
