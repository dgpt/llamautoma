import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint, task } from '@langchain/langgraph'
import { z } from 'zod'
import * as fastDiff from 'fast-diff'
import { RunnableConfig } from '@langchain/core/runnables'
import { createTestContext, waitForResponse, type TestContext } from '../utils'

// Schema for diff output
const DiffSchema = z.string()

describe('Diff Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should generate diff for file modifications', async () => {
    const diffTask = task('diff', async (messages: BaseMessage[], runConfig?: RunnableConfig) => {
      return await ctx.chatModel.invoke(messages, runConfig)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'diff_test' },
      async (messages: BaseMessage[]) => {
        const config = {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'diff_test',
            [Symbol.toStringTag]: 'DiffConfigurable',
          },
        }
        const result = await diffTask(messages, config)
        return result
      }
    )

    const existingCode = `
import React from 'react';

export const Counter = () => {
  let count = 0;

  const increment = () => count++;
  const decrement = () => count--;

  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`

    const generatedCode = `
import React, { useState } from 'react';

interface CounterProps {
  initialValue?: number;
}

export const Counter: React.FC<CounterProps> = ({ initialValue = 0 }) => {
  const [count, setCount] = useState(initialValue);

  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);

  return (
    <div className="counter">
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`

    const messages = [
      { role: 'system', content: 'You are a diff generator. Generate a diff between these files.' },
      {
        role: 'system',
        content: JSON.stringify({
          existingFile: {
            path: 'src/components/Counter.tsx',
            content: existingCode,
          },
          generatedFile: {
            path: 'src/components/Counter.tsx',
            content: generatedCode,
          },
        }),
      },
    ].map(msg => new SystemMessage(msg.content))

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'diff_test',
          [Symbol.toStringTag]: 'DiffConfigurable',
        },
      })
    )
    const diff = result.content

    expect(() => DiffSchema.parse(diff)).not.toThrow()
    expect(diff).toContain('diff')

    // Verify diff accuracy using fast-diff
    const changes = fastDiff.default(existingCode, generatedCode)
    const insertions = changes.filter(([type]) => type === fastDiff.INSERT)
    const deletions = changes.filter(([type]) => type === fastDiff.DELETE)

    // Our diff should have caught all the major changes
    expect(diff.includes('useState')).toBe(true)
    expect(diff.includes('let count = 0')).toBe(true)
  })

  test('should handle new file creation', async () => {
    const diffTask = task('diff', async (messages: BaseMessage[], runConfig?: RunnableConfig) => {
      return await ctx.chatModel.invoke(messages, runConfig)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'diff_test' },
      async (messages: BaseMessage[]) => {
        const config = {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'diff_test',
            [Symbol.toStringTag]: 'DiffConfigurable',
          },
        }
        const result = await diffTask(messages, config)
        return result
      }
    )

    const newFileContent = `
import React from 'react';
import { Counter } from './Counter';

export const App = () => {
  return (
    <div>
      <h1>Counter App</h1>
      <Counter initialValue={5} />
    </div>
  );
};`

    const messages = [
      { role: 'system', content: 'You are a diff generator. Generate a diff for this new file.' },
      {
        role: 'system',
        content: JSON.stringify({
          generatedFile: {
            path: 'src/components/App.tsx',
            content: newFileContent,
          },
        }),
      },
    ].map(msg => new SystemMessage(msg.content))

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'diff_test',
          [Symbol.toStringTag]: 'DiffConfigurable',
        },
      })
    )
    const diff = result.content

    expect(() => DiffSchema.parse(diff)).not.toThrow()
    expect(diff).toContain('diff')
  })

  test('should handle file deletion', async () => {
    const diffTask = task('diff', async (messages: BaseMessage[], runConfig?: RunnableConfig) => {
      return await ctx.chatModel.invoke(messages, runConfig)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'diff_test' },
      async (messages: BaseMessage[]) => {
        const config = {
          configurable: {
            thread_id: ctx.threadId,
            checkpoint_ns: 'diff_test',
            [Symbol.toStringTag]: 'DiffConfigurable',
          },
        }
        const result = await diffTask(messages, config)
        return result
      }
    )

    const existingCode = `
import React from 'react';

// Deprecated component to be removed
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`

    const messages = [
      {
        role: 'system',
        content: 'You are a diff generator. Generate a diff for this file deletion.',
      },
      {
        role: 'system',
        content: JSON.stringify({
          existingFile: {
            path: 'src/components/OldCounter.tsx',
            content: existingCode,
          },
          action: 'delete',
        }),
      },
    ].map(msg => new SystemMessage(msg.content))

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'diff_test',
          [Symbol.toStringTag]: 'DiffConfigurable',
        },
      })
    )
    const diff = result.content

    expect(() => DiffSchema.parse(diff)).not.toThrow()
    expect(diff).toContain('diff')
    expect(diff).toContain('deleted file')
  })
})
