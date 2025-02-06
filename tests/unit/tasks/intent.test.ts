import { expect, test, describe } from 'bun:test'
import { intentTask } from '@/ai/tasks/intent'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

describe('Intent Task Tests', () => {
  test('should classify code generation request', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'Create a React component that displays a user profile.' }),
    ]

    const result = await intentTask({ messages })
    console.log(result)
    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should classify chat conversation', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'What are the main features of TypeScript?' }),
    ]

    const result = await intentTask({ messages })
    console.log(result)
    expect(result).toBeDefined()
    expect(result.type).toBe('chat')
    expect(result.explanation).toBeDefined()
  })

  test('should handle ambiguous requests with appropriate confidence', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({ content: 'How do I implement a React counter?' }),
    ]

    const result = await intentTask({ messages })
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code') // Should prefer code for implementation questions
    expect(result.explanation).toBeDefined()
  })

  test('should consider conversation context', async () => {
    const messages = [
      new HumanMessage({ content: 'Please write a function that returns the sum of two numbers.' }),
      new HumanMessage({ content: 'and a test?' }),
    ]

    const result = await intentTask({ messages })
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should handle empty messages array', async () => {
    const messages = [new SystemMessage({ content: 'You are a helpful assistant.' })]

    await expect(intentTask({ messages })).rejects.toThrow('No user message found')
  })

  test('should handle technical discussion without code request', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({
        content: 'Can you explain the difference between React hooks and class components?',
      }),
    ]

    const result = await intentTask({ messages })

    expect(result).toBeDefined()
    expect(result.type).toBe('chat')
    expect(result.explanation).toBeDefined()
  })

  test('should classify file operation requests as code', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({
        content: 'Create a new file called config.ts with TypeScript configuration.',
      }),
    ]

    const result = await intentTask({ messages })
    console.log(result)

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })

  test('should classify debugging requests as code', async () => {
    const messages = [
      new SystemMessage({ content: 'You are a helpful assistant.' }),
      new HumanMessage({
        content:
          'Fix this error in my React component: TypeError: Cannot read property of undefined',
      }),
    ]

    const result = await intentTask({ messages })

    expect(result).toBeDefined()
    expect(result.type).toBe('code')
    expect(result.explanation).toBeDefined()
  })
})
