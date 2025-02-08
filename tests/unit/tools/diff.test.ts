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
    streamHandler.on('data', (data: Buffer | string) => {
      try {
        const decoded = mockStream.decodeEvent(data)
        if (decoded.type === 'file_request') {
          const { paths } = decoded.data
          for (const path of paths) {
            const content = mockStream.getFile(path)
            if (content) {
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
    streamHandler.removeAllListeners()
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

      // Add logging to track the request flow
      streamHandler.on('data', (data: Buffer | string) => {
        try {
          // Use the mock stream's decodeEvent helper
          const event = mockStream.decodeEvent(data)
          console.log('Decoded event:', event)
        } catch (error) {
          console.error('Failed to parse event:', error)
        }
      })

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
      // Mock the file to be deleted
      mockStream.mockFile(
        'src/components/OldCounter.tsx',
        `
import React from 'react';
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`
      )

      const input = {
        files: [
          {
            path: 'src/components/OldCounter.tsx',
            content: '',
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
    })
  })

  describe('Chat Model Invocation', () => {
    test('should generate readable diff for modifications via chat', async () => {
      const messages = [
        new SystemMessage('You are a diff generator. Generate a diff between these files.'),
        new SystemMessage(
          JSON.stringify({
            existingFile: {
              path: 'src/components/Counter.tsx',
              content: `
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
};`,
            },
            generatedFile: {
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
            },
          })
        ),
      ]

      // Mock the original file content for the diff tool
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

      const result = await waitForResponse(ctx.chatModel.invoke(messages))
      const diff = result.content as string

      // Loose expectations for chat model response
      expect(diff).toBeTruthy()
      expect(diff).toInclude('Counter.tsx')
      expect(diff).toMatch(/[-+].*count/) // Should show changes related to count
    })

    test('should generate readable diff for new file via chat', async () => {
      const messages = [
        new SystemMessage('You are a diff generator. Generate a diff for this new file.'),
        new SystemMessage(
          JSON.stringify({
            generatedFile: {
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
            },
          })
        ),
      ]

      const result = await waitForResponse(ctx.chatModel.invoke(messages))
      const diff = result.content as string

      // Loose expectations for chat model response
      expect(diff).toBeTruthy()
      expect(diff).toInclude('App.tsx')
      expect(diff).toMatch(/[+].*Counter/) // Should show Counter component being added
    })

    test('should generate readable diff for file deletion via chat', async () => {
      const messages = [
        new SystemMessage('You are a diff generator. Generate a diff for this file deletion.'),
        new SystemMessage(
          JSON.stringify({
            existingFile: {
              path: 'src/components/OldCounter.tsx',
              content: `
import React from 'react';
export const OldCounter = () => {
  return <div>Old counter implementation</div>;
};`,
            },
            action: 'delete',
          })
        ),
      ]

      const result = await waitForResponse(ctx.chatModel.invoke(messages))
      const diff = result.content as string

      // Loose expectations for chat model response
      expect(diff).toBeTruthy()
      expect(diff).toInclude('OldCounter.tsx')
      expect(diff).toMatch(/[-].*OldCounter/) // Should show OldCounter being removed
    })
  })
})
