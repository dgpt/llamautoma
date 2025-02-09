import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test'
import { runTool } from '@/ai/tools/run'
import { mockStream, setTestMode, resetTestMode } from '@/tests/mocks/stream'
import type { StreamEvent } from '@/types/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'

describe('Run Tool', () => {
  beforeEach(() => {
    mockStream.clearMocks()
    setTestMode()

    // Mock the stream module to handle run commands
    mock.module('@/stream', () => ({
      createStreamResponse: (messages: AsyncIterable<StreamEvent>) => {
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const message of messages) {
                // Handle command request
                const response: StreamEvent = {
                  type: 'response',
                  task: 'command',
                  content: JSON.stringify({
                    type: 'command_chunk',
                    data: {
                      content: 'mock command output',
                      done: true,
                    },
                  }),
                  timestamp: Date.now(),
                }
                const compressed = compressAndEncodeMessage(response)
                controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))

                // Send completion
                const complete: StreamEvent = {
                  type: 'complete',
                  task: 'command',
                  timestamp: Date.now(),
                  responses: [
                    {
                      type: 'command_complete',
                      data: {
                        exitCode: 0,
                      },
                    },
                  ],
                }
                const compressedComplete = compressAndEncodeMessage(complete)
                controller.enqueue(new TextEncoder().encode(`data: ${compressedComplete}\n\n`))
              }
            } finally {
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      },
      readClientStream: async function* (reader: ReadableStreamDefaultReader<Uint8Array>) {
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value)
            const messages = buffer.split('\n\n')
            buffer = messages.pop() || ''

            for (const message of messages) {
              if (!message.startsWith('data: ')) continue
              try {
                yield decodeAndDecompressMessage(message.slice(6))
              } catch (error) {
                logger.error('Stream decoding error:', error)
              }
            }
          }
        } finally {
          reader.releaseLock()
        }
      },
    }))
  })

  afterEach(() => {
    resetTestMode()
    mockStream.removeAllListeners()
  })

  test('should format basic command', async () => {
    const result = await runTool.invoke({ command: 'ls -la' })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle command errors', async () => {
    await expect(runTool.invoke({ command: '' })).rejects.toThrow()
  })

  test('should handle commands with special characters', async () => {
    const result = await runTool.invoke({
      command: 'echo "Hello & World"',
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle commands with pipes', async () => {
    const result = await runTool.invoke({
      command: 'ls -la | grep ".ts"',
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle commands with environment variables', async () => {
    const result = await runTool.invoke({
      command: 'echo $HOME',
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle command timeout', async () => {
    const result = await runTool.invoke({
      command: 'sleep 1',
      timeout: 5000,
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle working directory', async () => {
    const result = await runTool.invoke({
      command: 'pwd',
      cwd: '/tmp',
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })

  test('should handle environment variables in config', async () => {
    const result = await runTool.invoke({
      command: 'echo $TEST_VAR',
      env: { TEST_VAR: 'test value' },
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('output')
    expect(parsed).toHaveProperty('exitCode')
  })
})
