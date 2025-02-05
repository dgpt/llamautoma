import { expect, test, describe } from 'bun:test'
import { summarizerTask } from '@/ai/tasks/summarizer'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'

describe('Summarizer Task Tests', () => {
  test('should summarize short conversation', async () => {
    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage('Hello! Can you help me with TypeScript?'),
      new AIMessage('Of course! What would you like to know about TypeScript?'),
      new HumanMessage('How do I define an interface?'),
    ]

    const input = {
      messages,
    }

    const result = await summarizerTask(input)

    expect(result.messages).toBeDefined()
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(result.summary).toBeDefined()
  })

  test('should handle long conversation with code blocks', async () => {
    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage('Help me create a React component.'),
      new AIMessage(
        "Here's a simple React component:\n```tsx\ninterface Props {\n  name: string;\n}\n\nconst Greeting = ({ name }: Props) => {\n  return <h1>Hello, {name}!</h1>;\n};\n```"
      ),
      new HumanMessage('Can you add state to it?'),
      new AIMessage(
        "Here's the component with state:\n```tsx\nimport { useState } from 'react';\n\ninterface Props {\n  name: string;\n}\n\nconst Greeting = ({ name }: Props) => {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <h1>Hello, {name}!</h1>\n      <button onClick={() => setCount(c => c + 1)}>\n        Clicked {count} times\n      </button>\n    </div>\n  );\n};\n```"
      ),
      new HumanMessage('Thanks! How do I test this component?'),
    ]

    const input = {
      messages,
    }

    const result = await summarizerTask(input)

    expect(result.messages).toBeDefined()
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(result.summary).toBeDefined()
    // Ensure code blocks are preserved in summary
    expect(result.summary).toContain('```tsx')
  })

  test('should preserve important context when summarizing', async () => {
    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage('I need help with a TypeScript project.'),
      new AIMessage('What kind of project are you working on?'),
      new HumanMessage('A React app with Next.js'),
      new AIMessage('Great choice! What specific help do you need?'),
      new HumanMessage('I need to implement authentication.'),
      new AIMessage('I recommend using NextAuth.js. Would you like to see an example?'),
      new HumanMessage('Yes please!'),
    ]

    const input = {
      messages,
    }

    const result = await summarizerTask(input)

    expect(result.messages).toBeDefined()
    // Key information should be preserved
    expect(result.summary).toContain('React')
    expect(result.summary).toContain('Next.js')
    expect(result.summary).toContain('authentication')
  })

  test('should handle empty or invalid input', async () => {
    const input = {
      messages: [],
    }

    const result = await summarizerTask(input)

    expect(result.messages).toEqual([])
    expect(result.summary).toBe('')
  })

  test('should handle messages with special characters and formatting', async () => {
    const messages = [
      new SystemMessage('You are a helpful assistant.'),
      new HumanMessage('# Hello!\n\n* Point 1\n* Point 2\n\n```special chars: $@#%```'),
      new AIMessage('## Hi there!\n\n1. First\n2. Second\n\n> Quote here'),
    ]

    const input = {
      messages,
    }

    const result = await summarizerTask(input)

    expect(result.messages).toBeDefined()
    // Ensure markdown and special characters are handled properly
    expect(result.summary).toMatch(/[#*>`]/) // Should preserve some formatting characters
  })
})
