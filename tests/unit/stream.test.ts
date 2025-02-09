import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import {
  createOutboundStream,
  createStreamResponse,
  readInboundStream,
  StreamManager,
  type ServerToClientMessage,
  type ClientToServerMessage,
} from '@/stream'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { mockClientResponse, mockStream } from '@/tests/unit/utils'

describe('Stream Library', () => {
  let mockResponse: ReturnType<typeof mock>

  beforeEach(() => {
    mockResponse = mock(() => {})
    mockResponse.prototype = Response.prototype
  })

  afterEach(() => {
    mock.restore()
  })

  describe('createStreamResponse', () => {
    test('should create SSE response with proper headers', () => {
      const messages = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'chat', content: 'test', timestamp: Date.now() } as ServerToClientMessage
        },
      }

      const response = createStreamResponse(messages)
      expect(response).toBeInstanceOf(Response)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(response.headers.get('Connection')).toBe('keep-alive')
    })

    test('should stream compressed messages', async () => {
      const testMessage: ServerToClientMessage = {
        type: 'chat',
        content: 'test',
        timestamp: Date.now(),
      }
      const messages = {
        [Symbol.asyncIterator]: async function* () {
          yield testMessage
        },
      }

      const response = createStreamResponse(messages)
      const reader = response.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toStartWith('data: ~')
      const decoded = decodeAndDecompressMessage(text.slice(6))
      expect(decoded).toEqual(testMessage)
    })

    test('should handle stream errors gracefully', async () => {
      const messages = {
        [Symbol.asyncIterator]: async function* () {
          throw new Error('test error')
        },
      }

      const response = createStreamResponse(messages)
      const reader = response.body!.getReader()
      const result = await reader.read()
      expect(result.done).toBe(true)
    })
  })

  describe('readInboundStream', () => {
    test('should decode compressed messages', async () => {
      const testMessage: ClientToServerMessage = {
        type: 'input',
        data: 'test',
        timestamp: Date.now(),
      }
      const compressed = compressAndEncodeMessage(testMessage)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
          controller.close()
        },
      })

      const reader = stream.getReader()
      const messages: ClientToServerMessage[] = []
      for await (const message of readInboundStream(reader)) {
        messages.push(message)
      }

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(testMessage)
    })

    test('should handle invalid messages', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: invalid\n\n'))
          controller.close()
        },
      })

      const reader = stream.getReader()
      const messages: ClientToServerMessage[] = []
      for await (const message of readInboundStream(reader)) {
        messages.push(message)
      }

      expect(messages).toHaveLength(0)
    })

    test('should handle stream errors', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error('test error'))
        },
      })

      const reader = stream.getReader()
      const messages: ClientToServerMessage[] = []
      for await (const message of readInboundStream(reader)) {
        messages.push(message)
      }

      expect(messages).toHaveLength(0)
    })
  })

  describe('StreamManager', () => {
    test('should add and remove message handlers', () => {
      const manager = new StreamManager()
      const handler = mock(() => {})

      manager.onOutboundMessage(handler)
      manager.broadcast({ type: 'chat', content: 'test', timestamp: Date.now() })
      expect(handler).toHaveBeenCalledTimes(1)

      manager.offOutboundMessage(handler)
      manager.broadcast({ type: 'chat', content: 'test', timestamp: Date.now() })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    test('should handle handler errors', () => {
      const manager = new StreamManager()
      const handler = () => {
        throw new Error('test error')
      }

      manager.onOutboundMessage(handler)
      expect(() =>
        manager.broadcast({ type: 'chat', content: 'test', timestamp: Date.now() })
      ).not.toThrow()
    })

    test('should stream messages to handlers', async () => {
      const manager = new StreamManager()
      const handler = mock(() => {})
      const messages = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'chat', content: 'test1', timestamp: Date.now() } as ServerToClientMessage
          yield { type: 'chat', content: 'test2', timestamp: Date.now() } as ServerToClientMessage
        },
      }

      manager.onOutboundMessage(handler)
      const received: ServerToClientMessage[] = []
      for await (const message of manager.streamOutbound(messages)) {
        received.push(message)
      }

      expect(handler).toHaveBeenCalledTimes(2)
      expect(received).toHaveLength(2)
    })

    test('should handle stream errors in handlers', async () => {
      const manager = new StreamManager()
      const handler = () => {
        throw new Error('test error')
      }
      const messages = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'chat', content: 'test', timestamp: Date.now() } as ServerToClientMessage
        },
      }

      manager.onOutboundMessage(handler)
      const received: ServerToClientMessage[] = []
      for await (const message of manager.streamOutbound(messages)) {
        received.push(message)
      }

      expect(received).toHaveLength(1)
    })

    test('should add and remove inbound message handlers', () => {
      const manager = new StreamManager()
      const handler = mock(() => {})

      manager.onInboundMessage(handler)
      const testMessage: ClientToServerMessage = {
        type: 'input',
        data: 'test',
        timestamp: Date.now(),
      }

      // Create a test stream
      const stream = new ReadableStream({
        start(controller) {
          const compressed = compressAndEncodeMessage(testMessage)
          controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
          controller.close()
        },
      })

      // Start reading from the stream
      manager.startInboundStream('test', stream.getReader())

      // Wait for the stream to process
      setTimeout(() => {
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(testMessage)

        manager.offInboundMessage(handler)
        manager.startInboundStream('test2', stream.getReader())

        setTimeout(() => {
          expect(handler).toHaveBeenCalledTimes(1)
        }, 100)
      }, 100)
    })

    test('should handle inbound stream errors', async () => {
      const manager = new StreamManager()
      const handler = mock(() => {})

      manager.onInboundMessage(handler)

      // Create a stream that errors
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error('test error'))
        },
      })

      await manager.startInboundStream('test', stream.getReader())
      expect(handler).not.toHaveBeenCalled()
    })

    test('should stop streams properly', async () => {
      const manager = new StreamManager()
      const handler = mock(() => {})

      manager.onInboundMessage(handler)

      // Create test streams
      const stream1 = new ReadableStream({
        start(controller) {
          const testMessage: ClientToServerMessage = {
            type: 'input',
            data: 'test1',
            timestamp: Date.now(),
          }
          const compressed = compressAndEncodeMessage(testMessage)
          controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
        },
      })

      const stream2 = new ReadableStream({
        start(controller) {
          const testMessage: ClientToServerMessage = {
            type: 'input',
            data: 'test2',
            timestamp: Date.now(),
          }
          const compressed = compressAndEncodeMessage(testMessage)
          controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
        },
      })

      // Start both streams
      manager.startInboundStream('stream1', stream1.getReader())
      manager.startInboundStream('stream2', stream2.getReader())

      // Stop one stream
      await manager.stopStream('stream1')
      expect(handler).toHaveBeenCalledTimes(1)

      // Stop all streams
      await manager.stopAllStreams()
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })
})
