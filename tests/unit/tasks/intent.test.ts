import { expect, test, describe, beforeEach } from 'bun:test'
import { intentTask, type Intent } from '@/ai/tasks/intent'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { createTestContext, type TestContext } from '../utils'
import { entrypoint } from '@langchain/langgraph'
import type { RunnableConfig } from '@langchain/core/runnables'

describe('Intent Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should classify code generation request', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'Create a React component that displays a user profile.' }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should classify chat conversation', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'What are the main features of TypeScript?' }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )
    console.log(result)
    expect(result).toBeDefined()
    expect(result.type).toBe('chat')
    expect(result.explanation).toBeDefined()
  })

  test('should handle ambiguous requests with appropriate confidence', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'How do I implement a React counter?' }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )

    expect(result).toBeDefined()
    expect(result.type).toBe('code') // Should prefer code for implementation questions
    expect(result.explanation).toBeDefined()
  })

  test('should consider conversation context', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new HumanMessage({ content: 'Please write a function that returns the sum of two numbers.' }),
      new HumanMessage({ content: 'and a test?' }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should handle technical discussion without code request', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({
        content: 'Can you explain the difference between React hooks and class components?',
      }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )

    expect(result).toBeDefined()
    expect(result.type).toBe('chat')
    expect(result.explanation).toBeDefined()
  })

  test('should classify file operation requests as code', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new HumanMessage({
        content: 'Create a new file called config.ts with TypeScript configuration.',
      }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should classify debugging requests as code', async () => {
    const workflow = entrypoint<{ messages: BaseMessage[] }, Promise<Intent>>(
      {
        checkpointer: ctx.memorySaver,
        name: 'intent_test',
      },
      async (input: { messages: BaseMessage[] }, config?: RunnableConfig) => {
        return intentTask(input, config)
      }
    )

    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({
        content:
          'Fix this error in my React component: TypeError: Cannot read property of undefined',
      }),
    ]

    const result = await workflow.invoke(
      { messages },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'intent_test',
        },
      }
    )
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })
})
