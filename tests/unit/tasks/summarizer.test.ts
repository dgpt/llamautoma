import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { summarizerTask } from '@/ai/tasks/summarizer'
import { SummarySchema, type Summary } from 'llamautoma-types'

describe('Summarizer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should summarize long conversation', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
        })
        console.log(`Summarizer result: ${JSON.stringify(result)}`)
        return result
      }
    )

    // Create a long conversation
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      new HumanMessage('Create a React counter component'),
      new HumanMessage('Make sure to add TypeScript support'),
      new HumanMessage('Can you also add some styling?'),
      new HumanMessage('Please include error handling'),
      new HumanMessage('Add documentation for the component'),
      new HumanMessage('Can we add unit tests?'),
      new HumanMessage('Make it responsive'),
      new HumanMessage('Add accessibility features'),
      new HumanMessage('Include PropTypes validation'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'summarizer_test',
        },
      })
    )
    const summary = result as Summary

    // Verify schema and structure
    expect(() => SummarySchema.parse(summary)).not.toThrow()
    expect(summary.messages).toBeDefined()
    expect(summary.messages.length).toBe(2) // System message + summary
    expect(summary.summary).toBeDefined()
    expect(typeof summary.summary).toBe('string')

    // Verify the summary is actually shorter
    const originalLength = messages.map(m => m.content).join('').length
    expect(summary.summary.length).toBeLessThan(originalLength)
  })

  test('should preserve system message', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
        })
        return result
      }
    )

    const systemMsg = 'You are a code generation assistant.'
    const messages = [
      new SystemMessage(systemMsg),
      new HumanMessage('Create a React component'),
      new HumanMessage('Add TypeScript support'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'summarizer_test',
        },
      })
    )
    const summary = result as Summary

    expect(() => SummarySchema.parse(summary)).not.toThrow()
    expect(summary.messages[0]).toBeInstanceOf(SystemMessage)
    expect(summary.messages[0].content).toBe(systemMsg)
  })

  test('should handle empty conversation', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
        })
        return result
      }
    )

    const messages = [new SystemMessage('You are a code generation assistant.')]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'summarizer_test',
        },
      })
    )
    const summary = result as Summary

    expect(() => SummarySchema.parse(summary)).not.toThrow()
    expect(summary.messages).toBeDefined()
    expect(summary.messages.length).toBe(2)
    expect(summary.summary).toBeDefined()
  })
})
