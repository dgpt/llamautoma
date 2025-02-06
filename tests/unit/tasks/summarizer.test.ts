import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage, AIMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { summarizerTask } from '@/ai/tasks/summarizer'
import { SummarySchema, type Summary } from 'llamautoma-types'
import { DEFAULT_CONFIG } from 'llamautoma-types'

describe('Summarizer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should return original messages when under token limit', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
          maxContextTokens: DEFAULT_CONFIG.memory.maxContextTokens,
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage('Hello!'),
      new AIMessage('Hi there!'),
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
    expect(summary.messages).toEqual(messages)
    expect(summary.summary).toBe('')
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
          maxContextTokens: 100, // Small limit to force summarization
        })
        return result
      }
    )

    // Create a long conversation
    const messages = [
      new SystemMessage('You are a code generation assistant.'),
      ...Array(5)
        .fill(null)
        .flatMap((_, i) => [
          new HumanMessage(`User message ${i + 1}. `.repeat(10)),
          new AIMessage(`Assistant response ${i + 1}. `.repeat(10)),
        ]),
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
    expect(summary.messages[0]).toBeInstanceOf(SystemMessage)
    expect(summary.messages).toHaveLength(2) // System message + summary
    expect(summary.summary).toBeDefined()
    expect(typeof summary.summary).toBe('string')

    // Verify the summary is actually shorter
    const originalLength = messages.map(m => m.content).join('').length
    expect(summary.summary.length).toBeLessThan(originalLength)
  })

  test('should preserve all system messages', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
          maxContextTokens: 100, // Small limit to force summarization
        })
        return result
      }
    )

    const systemMessages = [
      new SystemMessage('System message 1'),
      new SystemMessage('System message 2'),
      new SystemMessage('System message 3'),
    ]

    const messages = [...systemMessages, new HumanMessage('Hello'), new AIMessage('Hi')]

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
    const resultSystemMessages = summary.messages.filter(msg => msg instanceof SystemMessage)
    expect(resultSystemMessages).toEqual(systemMessages)
  })

  test('should handle complex message content', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
          maxContextTokens: 100, // Small limit to force summarization
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'code', code: 'console.log("test")' },
        ],
      }),
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
    expect(summary.messages).toBeDefined()
    expect(summary.messages[0]).toBeInstanceOf(SystemMessage)
    expect(summary.summary).toBeDefined()
  })

  test('should handle empty message list', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'summarizer_test',
      },
      async (messages: BaseMessage[]) => {
        const result = await summarizerTask({
          messages,
          maxContextTokens: DEFAULT_CONFIG.memory.maxContextTokens,
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
    const summary = result as Summary

    expect(() => SummarySchema.parse(summary)).not.toThrow()
    expect(summary.messages).toEqual([])
    expect(summary.summary).toBe('')
  })
})
