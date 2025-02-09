import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { SystemMessage } from '@langchain/core/messages'
import { createTestContext, TestContext, waitForResponse } from '../utils'
import { diffTool } from '@/ai/tools/diff'
import { mockStream, setTestMode, resetTestMode } from '@/tests/mocks/stream'
import { streamHandler } from '@/stream'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import type { StreamEvent } from '@/types/stream'

describe('Diff Tool', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    mockStream.clearMocks()
    setTestMode()

    // Listen for file requests and respond with mock content
    mockStream.on('data', (data: Buffer | string) => {
      try {
        const decoded = mockStream.decodeEvent(data)
        if (decoded.type === 'file_request') {
          const { paths } = decoded.data
          for (const path of paths) {
            const content = mockStream.getFile(path)
            if (content !== undefined) {
              // Emit file chunk response
              const response: StreamEvent = {
                type: 'response',
                task: 'file',
                content: JSON.stringify({
                  type: 'file_chunk',
                  data: {
                    path,
                    content: content,
                    done: true,
                  },
                }),
                timestamp: Date.now(),
              }
              mockStream.emit('data', response)
            } else {
              // Emit error for non-existent file
              const errorEvent: StreamEvent = {
                type: 'error',
                task: 'file',
                error: `File not found: ${path}`,
                timestamp: Date.now(),
              }
              mockStream.emit('data', errorEvent)
            }
          }
          // Send completion
          const complete: StreamEvent = {
            type: 'complete',
            task: 'file',
            timestamp: Date.now(),
          }
          mockStream.emit('data', complete)
        }
      } catch (error) {
        // Emit error response
        const errorEvent: StreamEvent = {
          type: 'error',
          task: 'file',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }
        mockStream.emit('data', errorEvent)
      }
    })
  })

  afterEach(() => {
    resetTestMode()
    mockStream.removeAllListeners()
  })

  describe('Direct Tool Invocation', () => {
    test('should generate diff for file modifications', async () => {
      // Mock the original file content
      mockStream.mockFile(
        'src/components/Counter.tsx',
        `
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
      )

      const input = {
        files: [
          {
            path: 'src/components/Counter.tsx',
            content: `
import React, { useState } from 'react';
const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count - 1)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
};`,
            type: 'update' as const,
          },
        ],
      }

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/Counter.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // Each diff entry should be a tuple of [operation, content]
      diffs[0].diff.forEach((entry: [number, string]) => {
        expect(entry).toBeArray()
        expect(entry).toHaveLength(2)
        expect(entry[0]).toBeNumber()
        expect(entry[1]).toBeString()
      })
    })

    test('should handle new file creation', async () => {
      const input = {
        files: [
          {
            path: 'src/components/App.tsx',
            content: `
import React from 'react';
import { Counter } from './Counter';

export const App = () => (
  <div>
    <h1>Counter App</h1>
    <Counter initialValue={5} />
  </div>
);`,
            type: 'create' as const,
          },
        ],
      }

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/App.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // For new files, the diff should show everything as added
      const addedContent = diffs[0].diff.filter((entry: [number, string]) => entry[0] === 1)
      expect(addedContent).not.toBeEmpty()
    })

    test('should handle file deletion', async () => {
      // Mock the file to be deleted with non-empty content
      const fileContent = `
import React from 'react';
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`
      mockStream.mockFile('src/components/OldCounter.tsx', fileContent)

      // Verify the mock file exists
      expect(mockStream.getFile('src/components/OldCounter.tsx')).toBe(fileContent)

      const input = {
        files: [
          {
            path: 'src/components/OldCounter.tsx',
            content: fileContent, // Pass the existing content to show as removed
            type: 'delete' as const,
          },
        ],
      }

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/OldCounter.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // For deleted files, the diff should show everything as removed
      const removedContent = diffs[0].diff.filter((entry: [number, string]) => entry[0] === -1)
      expect(removedContent).not.toBeEmpty()
      expect(removedContent[0][1]).toContain('OldCounter')
    })
  })

  describe('Chat Model Invocation', () => {
    test('should generate readable diff for modifications via chat', async () => {
      const input = {
        files: [
          {
            path: 'src/components/Counter.tsx',
            content: `
import React, { useState } from 'react';
export const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count - 1)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
};`,
            type: 'update' as const,
          },
        ],
      }

      mockStream.mockFile(
        'src/components/Counter.tsx',
        `
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
      )

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/Counter.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()
    })

    test('should generate readable diff for new file via chat', async () => {
      const input = {
        files: [
          {
            path: 'src/components/App.tsx',
            content: `
import React from 'react';
import { Counter } from './Counter';

export const App = () => (
  <div>
    <h1>Counter App</h1>
    <Counter initialValue={5} />
  </div>
);`,
            type: 'create' as const,
          },
        ],
      }

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/App.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()
    })

    test('should generate readable diff for file deletion via chat', async () => {
      // Mock the file to be deleted
      const fileContent = `
import React from 'react';
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`
      mockStream.mockFile('src/components/OldCounter.tsx', fileContent)

      const input = {
        files: [
          {
            path: 'src/components/OldCounter.tsx',
            content: fileContent, // Pass the existing content to show as removed
            type: 'delete' as const,
          },
        ],
      }

      const result = await diffTool.invoke(input)
      const diffs = JSON.parse(result)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/OldCounter.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()
    })
  })
})
