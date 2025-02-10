import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import {
  listen,
  stopListener,
  stopListening,
  write,
  broadcast,
  broadcastMessage,
  broadcastProgress,
  createResponseStream,
} from '@/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import type { ServerToClientMessage, ClientToServerMessage } from '@/types/stream'

describe('Stream Module', () => {
  let mockHandler: (message: ClientToServerMessage) => void
  let receivedMessages: ClientToServerMessage[] = []
  let unsubscribe: (() => void) | null = null
  let stream: ReadableStream<Uint8Array>
  let reader: ReadableStreamDefaultReader<Uint8Array>
  let listenerId: string

  beforeEach(() => {
    receivedMessages = []
    mockHandler = (message: ClientToServerMessage) => {
      receivedMessages.push(message)
    }

    // Create response stream and start listening
    stream = createResponseStream()
    reader = stream.getReader()
    listenerId = listen(reader)

    // Register mock handler
    const messageStream = (globalThis as any).messageStream
    unsubscribe = messageStream.onInboundMessage(mockHandler)
  })

  afterEach(async () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    await stopListener(listenerId)
    await reader.cancel()
  })

  describe('listen', () => {
    test('should support multiple concurrent listeners', async () => {
      const messages1: ClientToServerMessage[] = []
      const messages2: ClientToServerMessage[] = []

      // Create two streams with separate handlers
      const stream1 = createResponseStream()
      const stream2 = createResponseStream()
      const reader1 = stream1.getReader()
      const reader2 = stream2.getReader()

      const messageStream = (globalThis as any).messageStream
      const unsubscribe1 = messageStream.onInboundMessage((msg: ClientToServerMessage) => {
        messages1.push(msg)
      })
      const unsubscribe2 = messageStream.onInboundMessage((msg: ClientToServerMessage) => {
        messages2.push(msg)
      })

      // Start both listeners
      const id1 = listen(reader1)
      const id2 = listen(reader2)

      // Send test messages
      const testMessage: ClientToServerMessage = {
        type: 'input',
        data: 'test data',
        timestamp: Date.now(),
      }
      const compressed = compressAndEncodeMessage(testMessage)
      write(`data: ${compressed}\n\n`)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      // Both handlers should receive the message
      expect(messages1).toHaveLength(1)
      expect(messages2).toHaveLength(1)
      expect(messages1[0]).toEqual(testMessage)
      expect(messages2[0]).toEqual(testMessage)

      // Cleanup
      unsubscribe1()
      unsubscribe2()
      await stopListener(id1)
      await stopListener(id2)
      await reader1.cancel()
      await reader2.cancel()
    })

    test('should handle stopping specific listeners', async () => {
      const messages1: ClientToServerMessage[] = []
      const messages2: ClientToServerMessage[] = []

      // Create two streams with separate handlers
      const stream1 = createResponseStream()
      const stream2 = createResponseStream()
      const reader1 = stream1.getReader()
      const reader2 = stream2.getReader()

      const messageStream = (globalThis as any).messageStream
      const unsubscribe1 = messageStream.onInboundMessage((msg: ClientToServerMessage) => {
        messages1.push(msg)
      })
      const unsubscribe2 = messageStream.onInboundMessage((msg: ClientToServerMessage) => {
        messages2.push(msg)
      })

      // Start both listeners
      const id1 = listen(reader1)
      const id2 = listen(reader2)

      // Stop first listener
      await stopListener(id1)

      // Send test message
      const testMessage: ClientToServerMessage = {
        type: 'input',
        data: 'test data',
        timestamp: Date.now(),
      }
      const compressed = compressAndEncodeMessage(testMessage)
      write(`data: ${compressed}\n\n`)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      // Only second handler should receive the message
      expect(messages1).toHaveLength(0)
      expect(messages2).toHaveLength(1)
      expect(messages2[0]).toEqual(testMessage)

      // Cleanup
      unsubscribe1()
      unsubscribe2()
      await stopListener(id2)
      await reader1.cancel()
      await reader2.cancel()
    })

    test('should decode and handle client messages', async () => {
      const testMessage: ClientToServerMessage = {
        type: 'input',
        data: 'test data',
        timestamp: Date.now(),
      }
      const compressed = compressAndEncodeMessage(testMessage)

      // Send test message through stream
      write(`data: ${compressed}\n\n`)

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual(testMessage)
    })

    test('should handle invalid messages', async () => {
      // Send invalid message
      write('invalid message\n\n')

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle stream errors', async () => {
      // Force stream error by stopping while processing
      write('data: invalid\n\n')
      await stopListener(listenerId)

      // Wait for error processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(0)
    })

    test('should handle multiple messages', async () => {
      const messages: ClientToServerMessage[] = [
        {
          type: 'input',
          data: 'test1',
          timestamp: Date.now(),
        },
        {
          type: 'input',
          data: 'test2',
          timestamp: Date.now(),
        },
      ]

      // Send multiple messages
      for (const msg of messages) {
        const compressed = compressAndEncodeMessage(msg)
        write(`data: ${compressed}\n\n`)
      }

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(receivedMessages).toHaveLength(2)
      expect(receivedMessages).toEqual(messages)
    })
  })

  describe('broadcast', () => {
    test('should compress and broadcast server messages', async () => {
      let broadcastedMessage: string | undefined

      // Create test message
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test content',
        timestamp: Date.now(),
      }

      // Mock handler to capture broadcasted message
      const mockHandler = (message: string) => {
        broadcastedMessage = message
      }

      // Register mock handler
      const messageStream = (globalThis as any).messageStream
      const unsubscribe = messageStream.onOutboundMessage(mockHandler)

      // Broadcast message
      broadcast(toAsyncIterable([testMessage]))

      // Verify message was compressed and broadcasted
      expect(broadcastedMessage).toBeDefined()
      const decodedMessage = decodeAndDecompressMessage(broadcastedMessage!)
      expect(decodedMessage).toEqual(testMessage)

      // Cleanup
      unsubscribe()
    })
  })

  describe('broadcastMessage', () => {
    test('should broadcast chat messages', async () => {
      let broadcastedMessage: string | undefined

      // Mock handler to capture broadcasted message
      const mockHandler = (message: string) => {
        broadcastedMessage = message
      }

      // Register mock handler
      const messageStream = (globalThis as any).messageStream
      const unsubscribe = messageStream.onOutboundMessage(mockHandler)

      // Broadcast message
      broadcastMessage('test message')

      // Verify message was compressed and broadcasted
      expect(broadcastedMessage).toBeDefined()
      const decodedMessage = decodeAndDecompressMessage(broadcastedMessage!)
      expect(decodedMessage).toHaveProperty('type', 'chat')
      expect(decodedMessage).toHaveProperty('content', 'test message')

      // Cleanup
      unsubscribe()
    })
  })

  describe('broadcastProgress', () => {
    test('should broadcast progress updates', async () => {
      let broadcastedMessage: string | undefined

      // Mock handler to capture broadcasted message
      const mockHandler = (message: string) => {
        broadcastedMessage = message
      }

      // Register mock handler
      const messageStream = (globalThis as any).messageStream
      const unsubscribe = messageStream.onOutboundMessage(mockHandler)

      // Broadcast progress
      broadcastProgress('test progress')

      // Verify message was compressed and broadcasted
      expect(broadcastedMessage).toBeDefined()
      const decodedMessage = decodeAndDecompressMessage(broadcastedMessage!)
      expect(decodedMessage).toHaveProperty('type', 'progress')
      expect(decodedMessage).toHaveProperty('content', 'test progress')

      // Cleanup
      unsubscribe()
    })
  })
})

// Helper function to convert array to async iterable
function toAsyncIterable<T>(arr: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield* arr
    },
  }
}
