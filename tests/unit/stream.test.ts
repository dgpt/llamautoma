import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test'
import { broadcast, onInboundMessage, onOutboundMessage, stopAllHandlers } from '@/stream'
import * as compression from '@/lib/compression'
import type { ServerToClientMessage, ClientToServerMessage } from '@/types/stream'

describe('Stream Module', () => {
  let receivedInboundMessages: ClientToServerMessage[] = []
  let receivedOutboundMessages: string[] = []
  let unsubscribeInbound: (() => void) | null = null
  let unsubscribeOutbound: (() => void) | null = null

  beforeEach(() => {
    receivedInboundMessages = []
    receivedOutboundMessages = []

    // Register message handlers
    unsubscribeInbound = onInboundMessage((message: ClientToServerMessage) => {
      receivedInboundMessages.push(message)
    })

    unsubscribeOutbound = onOutboundMessage((message: string) => {
      receivedOutboundMessages.push(message)
    })
  })

  afterEach(async () => {
    if (unsubscribeInbound) {
      unsubscribeInbound()
      unsubscribeInbound = null
    }
    if (unsubscribeOutbound) {
      unsubscribeOutbound()
      unsubscribeOutbound = null
    }
    await stopAllHandlers()
  })

  describe('message handling', () => {
    test('should handle single message broadcast', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test content',
        timestamp: Date.now(),
      }

      await broadcast(testMessage)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedInboundMessages[0]).toHaveProperty('type', 'input')
      expect(receivedInboundMessages[0]).toHaveProperty('data', testMessage.content)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle array of messages', async () => {
      const messages: ServerToClientMessage[] = [
        {
          type: 'chat',
          content: 'message 1',
          timestamp: Date.now(),
        },
        {
          type: 'chat',
          content: 'message 2',
          timestamp: Date.now(),
        },
      ]

      await broadcast(messages)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(2)
      expect(receivedInboundMessages[0]).toHaveProperty('data', messages[0].content)
      expect(receivedInboundMessages[1]).toHaveProperty('data', messages[1].content)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle string message broadcast', async () => {
      const testMessage = 'test content'

      await broadcast(testMessage)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedInboundMessages[0]).toHaveProperty('type', 'input')
      expect(receivedInboundMessages[0]).toHaveProperty('data', testMessage)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle empty messages', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: '',
        timestamp: Date.now(),
      }

      await broadcast(testMessage)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedInboundMessages[0]).toHaveProperty('data', '')
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle message compression and decompression', async () => {
      const originalMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test message',
        timestamp: Date.now(),
      }

      const compressed = compression.compressAndEncodeMessage([originalMessage])
      const decompressed = compression.decodeAndDecompressMessage(compressed)

      expect(Array.isArray(decompressed)).toBe(true)
      expect(decompressed[0]).toEqual(originalMessage)
    })

    test('should handle duplicate messages', async () => {
      const message: ServerToClientMessage = {
        type: 'chat',
        content: 'duplicate message',
        timestamp: Date.now(),
      }

      // Send the same message twice
      await broadcast(message)
      await broadcast(message)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(2)
      expect(receivedInboundMessages[0]).toHaveProperty('data', message.content)
      expect(receivedInboundMessages[1]).toHaveProperty('data', message.content)
      expect(receivedOutboundMessages).toHaveLength(2)
    })

    test('should handle message processing errors', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
        // @ts-expect-error Testing invalid field
        invalidField: true,
      }

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedInboundMessages[0]).toHaveProperty('data', testMessage.content)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle inbound handler errors', async () => {
      // Register error-throwing handler
      const errorHandler = onInboundMessage(() => {
        throw new Error('Handler error')
      })

      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clean up error handler
      errorHandler()
      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle outbound handler errors', async () => {
      // Register error-throwing handler
      const errorHandler = onOutboundMessage(() => {
        throw new Error('Handler error')
      })

      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clean up error handler
      errorHandler()
      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle multiple concurrent broadcasts', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        type: 'chat' as const,
        content: `message ${i}`,
        timestamp: Date.now(),
      }))

      // Send all messages concurrently
      await Promise.all(messages.map(msg => broadcast(msg)))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(receivedInboundMessages).toHaveLength(10)
      expect(receivedInboundMessages.map(m => m.data)).toEqual(messages.map(m => m.content))
      expect(receivedOutboundMessages).toHaveLength(10)
    })

    test('should handle stopping all handlers', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // First broadcast a message to ensure the stream is active
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clear the received messages arrays
      receivedInboundMessages.length = 0
      receivedOutboundMessages.length = 0

      // Stop all handlers
      await stopAllHandlers()

      // Try broadcasting again immediately
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(0)
    })

    test('should handle stream read timeout', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // First broadcast a message to ensure the stream is active
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clear the received messages arrays
      receivedInboundMessages.length = 0
      receivedOutboundMessages.length = 0

      // Wait longer than the stream timeout but shorter than test timeout
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Try broadcasting again
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have received the second message after stream reset
      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle stream write errors', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'x'.repeat(1024 * 1024), // 1MB message
        timestamp: Date.now(),
      }

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages.length).toBeGreaterThan(0)
      expect(receivedOutboundMessages.length).toBeGreaterThan(0)
    })

    test('should handle invalid message content', async () => {
      const testMessage = {
        type: 'chat',
        content: undefined,
        timestamp: Date.now(),
      } as unknown as ServerToClientMessage

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(1)
      expect(receivedInboundMessages[0]).toHaveProperty('data', '')
      expect(receivedOutboundMessages).toHaveLength(1)
    })

    test('should handle stream cleanup errors', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // First broadcast a message to ensure the stream is active
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Force cleanup multiple times
      await stopAllHandlers()
      await stopAllHandlers() // Second cleanup should handle already closed stream

      expect(receivedInboundMessages.length).toBeGreaterThan(0)
      expect(receivedOutboundMessages.length).toBeGreaterThan(0)
    })

    test('should handle message decoding errors', async () => {
      // Mock decodeAndDecompressMessage to throw
      mock.module('@/lib/compression', () => ({
        ...compression,
        decodeAndDecompressMessage: () => {
          throw new Error('Mock decode error')
        },
      }))

      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(1)

      // Restore original implementation
      mock.restore()
    })

    test('should handle stream read errors', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // First broadcast a message to ensure the stream is active
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clear the received messages arrays
      receivedInboundMessages.length = 0
      receivedOutboundMessages.length = 0

      // Force a read error by closing the stream
      await stopAllHandlers()

      // Try broadcasting again immediately
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(0)
    })

    test('should handle stream write errors', async () => {
      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clear received messages
      receivedInboundMessages.length = 0
      receivedOutboundMessages.length = 0

      // Stop all handlers to force write errors
      await stopAllHandlers()

      // Try broadcasting again immediately
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(0)
    })

    test('should handle listener startup errors', async () => {
      // Register a handler that will fail to start listening
      const handler = onInboundMessage(() => {
        throw new Error('Handler error')
      })

      // Wait for listener to start
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clean up
      handler()

      // No messages should have been processed
      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(0)
    })

    test('should handle broadcast errors', async () => {
      // Mock compressAndEncodeMessage to throw
      mock.module('@/lib/compression', () => ({
        ...compression,
        compressAndEncodeMessage: () => {
          throw new Error('Mock compress error')
        },
      }))

      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
      expect(receivedOutboundMessages).toHaveLength(0)

      // Restore original implementation
      mock.restore()
    })

    test('should handle stream listener errors', async () => {
      // Mock reader.read to throw a non-timeout error
      const originalTransformStream = globalThis.TransformStream
      globalThis.TransformStream = class MockTransform extends TransformStream {
        constructor() {
          super()
          Object.defineProperty(this, 'readable', {
            value: new ReadableStream({
              start(controller) {
                controller.error(new Error('Mock stream error'))
              },
            }),
          })
        }
      }

      // Register a handler to start listening
      const handler = onInboundMessage(() => {})

      // Wait for error to be logged
      await new Promise(resolve => setTimeout(resolve, 50))

      // Clean up
      handler()
      globalThis.TransformStream = originalTransformStream

      // Verify stream was stopped
      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
    })

    test('should handle non-timeout stream errors', async () => {
      // Mock reader.read to throw a non-timeout error
      const originalTransformStream = globalThis.TransformStream
      let errorThrown = false

      globalThis.TransformStream = class MockTransform extends TransformStream {
        constructor() {
          super()
          Object.defineProperty(this, 'readable', {
            value: new ReadableStream({
              async pull(controller) {
                if (!errorThrown) {
                  errorThrown = true
                  throw new Error('Non-timeout error')
                }
                controller.close()
              },
              cancel() {},
            }),
          })
        }
      }

      // Register a handler to start listening
      const handler = onInboundMessage(message => {
        receivedInboundMessages.push(message)
      })

      // Wait for error to be handled
      await new Promise(resolve => setTimeout(resolve, 50))

      // Clean up
      handler()
      globalThis.TransformStream = originalTransformStream

      // Try to broadcast a message - it should not be received since the stream is stopped
      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0) // No messages should be received
    })

    test('should handle stream close errors', async () => {
      // Mock writer.close and reader.cancel to throw
      const originalTransformStream = globalThis.TransformStream
      globalThis.TransformStream = class MockTransform extends TransformStream {
        constructor() {
          super()
          const mockWriter = {
            close() {
              throw new Error('Close error')
            },
            write() {
              return Promise.resolve()
            },
            releaseLock() {},
          }
          const mockReader = {
            cancel() {
              throw new Error('Cancel error')
            },
            read() {
              return Promise.resolve({ done: true, value: undefined })
            },
            releaseLock() {},
          }
          Object.defineProperty(this, 'writable', {
            value: { getWriter: () => mockWriter },
          })
          Object.defineProperty(this, 'readable', {
            value: { getReader: () => mockReader },
          })
        }
      }

      // Register a handler to start listening
      const handler = onInboundMessage(() => {})

      // Wait for stream to initialize
      await new Promise(resolve => setTimeout(resolve, 10))

      // Force stream reset
      await stopAllHandlers()

      // Clean up
      handler()
      globalThis.TransformStream = originalTransformStream

      // Verify we can still broadcast after error
      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
    })

    test('should handle listening promise errors', async () => {
      // Mock startListening to throw immediately
      const originalTransformStream = globalThis.TransformStream
      let hasThrown = false
      globalThis.TransformStream = class MockTransform extends TransformStream {
        constructor() {
          super()
          Object.defineProperty(this, 'readable', {
            value: new ReadableStream({
              async pull(controller) {
                if (!hasThrown) {
                  hasThrown = true
                  throw new Error('Start error')
                }
                controller.close()
              },
              cancel() {},
            }),
          })
        }
      }

      // Register a handler to trigger listening
      const handler = onInboundMessage(() => {})

      // Wait for error to be handled
      await new Promise(resolve => setTimeout(resolve, 50))

      // Clean up
      handler()
      globalThis.TransformStream = originalTransformStream

      // Verify we can still broadcast after error
      const testMessage = 'test message'
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedInboundMessages).toHaveLength(0)
    })
  })
})
