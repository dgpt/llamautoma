import { expect, test, describe, beforeEach } from 'bun:test'
import { SystemMessage } from '@langchain/core/messages'
import { createTestContext, TestContext, waitForResponse } from '../utils'

describe('Diff Tool', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should generate diff for file modifications', async () => {
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
      new SystemMessage('You are a diff generator. Generate a diff between these files.'),
      new SystemMessage(
        JSON.stringify({
          existingFile: {
            path: 'src/components/Counter.tsx',
            content: existingCode,
          },
          generatedFile: {
            path: 'src/components/Counter.tsx',
            content: generatedCode,
          },
        })
      ),
    ]

    const result = await waitForResponse(ctx.chatModel.invoke(messages))
    const diff = result.content as string

    // Log the actual diff output for debugging
    console.log('Actual diff output:', diff)

    // Validate diff format
    expect(diff).toBeTruthy()
    expect(diff).toContain('diff --git')
    expect(diff).toContain('src/components/Counter.tsx')
    expect(diff).toContain('-  let count = 0')
    expect(diff).toContain('+  const [count, setCount] = useState(initialValue)')
    expect(diff).toContain('onClick={decrement}')
    expect(diff).toContain('button')
  })

  test('should handle new file creation', async () => {
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
      new SystemMessage('You are a diff generator. Generate a diff for this new file.'),
      new SystemMessage(
        JSON.stringify({
          generatedFile: {
            path: 'src/components/App.tsx',
            content: newFileContent,
          },
        })
      ),
    ]

    const result = await waitForResponse(ctx.chatModel.invoke(messages))
    const diff = result.content as string

    expect(diff).toBeTruthy()
    expect(diff).toContain('diff')
    expect(diff).toContain('new file')
    expect(diff).toContain('Counter initialValue={5}')
  })

  test('should handle file deletion', async () => {
    const existingCode = `
import React from 'react';

// Deprecated component to be removed
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`

    const messages = [
      new SystemMessage('You are a diff generator. Generate a diff for this file deletion.'),
      new SystemMessage(
        JSON.stringify({
          existingFile: {
            path: 'src/components/OldCounter.tsx',
            content: existingCode,
          },
          action: 'delete',
        })
      ),
    ]

    const result = await waitForResponse(ctx.chatModel.invoke(messages))
    const diff = result.content as string

    expect(diff).toBeTruthy()
    expect(diff).toContain('diff')
    expect(diff).toContain('deleted file')
  })
})
