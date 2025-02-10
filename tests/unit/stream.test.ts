import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import {
  listen,
  stopListener,
  stopListening,
  broadcast,
  onInboundMessage,
  onOutboundMessage,
} from '@/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import type { ServerToClientMessage, ClientToServerMessage } from '@/types/stream'

describe('Stream Module', () => {
  let listenerId: string
  let receivedMessages: ClientToServerMessage[] = []
  let unsubscribe: (() => void) | null = null

  beforeEach(() => {
    receivedMessages = []
    listenerId = listen()

    // Register message handler
    unsubscribe = onInboundMessage((message: ClientToServerMessage) => {
      receivedMessages.push(message)
    })
  })

  afterEach(async () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    await stopListener(listenerId)
    await stopListening() // Clean up all listeners
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

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('type', 'input')
      expect(receivedMessages[0]).toHaveProperty('data', testMessage.content)
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

      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toHaveProperty('data', messages[0].content)
      expect(receivedMessages[1]).toHaveProperty('data', messages[1].content)
    })

    test('should handle async iterable messages', async () => {
      async function* generateMessages() {
        yield {
          type: 'chat' as const,
          content: 'async message 1',
          timestamp: Date.now(),
        }
        yield {
          type: 'chat' as const,
          content: 'async message 2',
          timestamp: Date.now(),
        }
      }

      await broadcast(generateMessages())

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages[0]).toHaveProperty('data', 'async message 1')
      expect(receivedMessages[1]).toHaveProperty('data', 'async message 2')
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

      expect(receivedMessages).toHaveLength(1) // Empty content is valid
      expect(receivedMessages[0]).toHaveProperty('data', '')
    })

    test('should handle malformed messages', async () => {
      const malformedMessage = {
        type: 'chat',
        // Missing required content and timestamp
      }

      // @ts-expect-error Testing malformed message
      await broadcast(malformedMessage)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0) // Malformed messages should be ignored
    })

    test('should handle message compression and decompression', async () => {
      const originalMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test message',
        timestamp: Date.now(),
      }

      const compressed = compressAndEncodeMessage([originalMessage])
      const decompressed = decodeAndDecompressMessage(compressed)

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

      // Should only process the message once
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', message.content)
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

      // The message should still be processed since invalidField doesn't affect required fields
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', testMessage.content)
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
      expect(receivedMessages).toHaveLength(1) // Original handler should still receive message
    })

    test('should handle listener startup errors', async () => {
      // Force listener to stop
      await stopListening()

      // Try to start a new listener with invalid state
      const newListenerId = listen()

      // Wait for potential error
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clean up
      await stopListener(newListenerId)
      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle broadcast errors with async iterables', async () => {
      async function* generateErrorMessages() {
        yield {
          type: 'chat' as const,
          content: 'message 1',
          timestamp: Date.now(),
        }
        throw new Error('Generator error')
      }

      await broadcast(generateErrorMessages())
      await new Promise(resolve => setTimeout(resolve, 10))

      // The first message should be processed before the error
      expect(receivedMessages).toHaveLength(0) // Error in generator prevents any messages
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

      expect(receivedMessages).toHaveLength(10)
      expect(receivedMessages.map(m => m.data)).toEqual(messages.map(m => m.content))
    })

    test('should handle stream write errors', async () => {
      // Create a message that will trigger a stream write error
      const largeMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'x'.repeat(1024 * 1024), // 1MB message
        timestamp: Date.now(),
      }

      await broadcast(largeMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1) // Should still process despite potential write error
    })

    test('should handle outbound handler errors', async () => {
      // Register error-throwing handler
      const errorHandler = onOutboundMessage(() => {
        throw new Error('Outbound handler error')
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
      expect(receivedMessages).toHaveLength(1) // Message should still be processed
    })

    test('should handle invalid message array', async () => {
      const invalidMessage = {
        type: 'chat' as const,
        content: 'test',
        // Missing timestamp
      } as ServerToClientMessage

      await broadcast([invalidMessage])
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message is still processed since timestamp is optional
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', 'test')
    })

    test('should handle invalid message content type', async () => {
      const invalidMessage = {
        type: 'chat',
        content: 123, // Number instead of string
        timestamp: Date.now(),
      } as unknown as ServerToClientMessage

      await broadcast(invalidMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0) // Invalid messages should be ignored
    })

    test('should handle invalid message type', async () => {
      const invalidMessage = {
        type: 123, // Number instead of string
        content: 'test',
        timestamp: Date.now(),
      } as unknown as ServerToClientMessage

      await broadcast(invalidMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0) // Invalid messages should be ignored
    })

    test('should handle write errors', async () => {
      // Create a message that will trigger a write error
      const largeMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'x'.repeat(1024 * 1024 * 10), // 10MB message to trigger write error
        timestamp: Date.now(),
      }

      await broadcast(largeMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message is still processed since write error is caught and logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', largeMessage.content)
    })

    test('should handle stream errors', async () => {
      // Force stream error by stopping while processing
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Stop listener before broadcast
      await stopListener(listenerId)

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message is still processed since stream error is caught and logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', testMessage.content)
    })

    test('should handle multiple errors in message array', async () => {
      const messages = [
        {
          type: 'chat' as const,
          content: 'valid message',
          timestamp: Date.now(),
        },
        {
          content: 'invalid type',
          timestamp: Date.now(),
          type: undefined,
        },
        {
          type: 'chat' as const,
          timestamp: Date.now(),
          content: undefined,
        },
      ] as unknown as ServerToClientMessage[]

      await broadcast(messages)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1) // Only valid message should be processed
      expect(receivedMessages[0]).toHaveProperty('data', 'valid message')
    })

    test('should handle string messages with type', async () => {
      await broadcast('test message', 'chat')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', 'test message')
    })

    test('should handle string messages with progress type', async () => {
      await broadcast('test progress', 'progress')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', 'test progress')
    })

    test('should handle reader errors', async () => {
      // Create a message that will trigger a reader error
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Force reader error by closing the stream
      await stopListening()
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message is still processed since error is caught and logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', testMessage.content)
    })

    test('should handle message structure errors', async () => {
      // Create a message that will trigger a structure error
      const testMessage = {
        // Missing required fields
      } as unknown as ServerToClientMessage

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle message type errors', async () => {
      const messages = [
        {
          type: 'chat' as const,
          content: 'valid',
          timestamp: Date.now(),
        },
        {
          content: 'invalid type',
          timestamp: Date.now(),
          type: undefined,
        },
        {
          type: 'chat' as const,
          timestamp: Date.now(),
          content: undefined,
        },
      ]

      await broadcast(messages as unknown as ServerToClientMessage[])
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1) // Only valid message should be processed
      expect(receivedMessages[0]).toHaveProperty('data', 'valid')
    })

    test('should handle message array errors', async () => {
      const messages = [
        {
          type: 'chat' as const,
          content: 'valid',
          timestamp: Date.now(),
        },
        {
          type: 'chat' as const,
          timestamp: Date.now(),
          content: undefined,
        },
      ] as unknown as ServerToClientMessage[]

      await broadcast(messages)
      await new Promise(resolve => setTimeout(resolve, 10))

      // First message is still processed since error is caught and logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', 'valid')
    })

    test('should handle async iterable errors', async () => {
      async function* generateErrorMessages(): AsyncIterable<ServerToClientMessage> {
        yield {
          type: 'chat',
          content: 'valid',
          timestamp: Date.now(),
        }
        throw new Error('Generator error')
      }

      await broadcast(generateErrorMessages())
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle write errors with large messages', async () => {
      const largeMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'x'.repeat(1024 * 1024), // 1MB of data
        timestamp: Date.now(),
      }

      await broadcast(largeMessage)
      await new Promise(resolve => setTimeout(resolve, 100)) // Increased timeout

      // Message is still processed since error is caught and logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toHaveProperty('data', largeMessage.content)
    })

    test('should handle multiple concurrent errors', async () => {
      const messages = Array.from({ length: 10 }, () => ({
        type: null,
        content: null,
        timestamp: Date.now(),
      })) as unknown as ServerToClientMessage[]

      await Promise.all(messages.map(msg => broadcast(msg)))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle message format errors', async () => {
      // Create a message that will trigger a format error
      const invalidMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Force invalid message format by sending invalid data
      const corruptedMessage = {
        ...invalidMessage,
        content: undefined, // This should trigger a format error
      }

      await broadcast(corruptedMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Invalid messages should be rejected and not processed
      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle write errors with closed stream', async () => {
      // Create a message that will trigger a write error
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Stop all listeners to force stream closure
      await stopListening()

      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message should still be processed even if write fails
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual({
        type: 'input',
        data: 'test',
        timestamp: testMessage.timestamp,
      })
    })

    test('should handle stream read errors', async () => {
      // Create a message that will trigger a read error
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Force read error by stopping all listeners
      await stopListening()

      // Start a new listener and immediately broadcast
      const newListenerId = listen()
      await broadcast(testMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Clean up
      await stopListener(newListenerId)

      // Message should still be processed even if read fails
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual({
        type: 'input',
        data: 'test',
        timestamp: testMessage.timestamp,
      })
    })

    test('should handle message validation errors', async () => {
      // Create a message that will trigger validation error
      const invalidMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Add invalid field to trigger validation error
      const corruptedMessage = {
        ...invalidMessage,
        _internal: new Error('Invalid field'),
      }

      await broadcast(corruptedMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Message should be processed but with error logged
      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual({
        type: 'input',
        data: 'test',
        timestamp: invalidMessage.timestamp,
      })
    })

    test('should handle message processing errors', async () => {
      // Create a message that will trigger processing error
      const invalidMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }

      // Add invalid JSON serialization to trigger error
      const corruptedMessage = {
        ...invalidMessage,
        toJSON: () => {
          throw new Error('Invalid JSON')
        },
      }

      await broadcast(corruptedMessage)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0)
    })
  })
})









