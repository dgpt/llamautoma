import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'

// Message types for client-server communication
export type MessageType = 'edit' | 'run' | 'chat' | 'status'

export type StreamMessage = {
  type: MessageType
  data: unknown
}

// Create a readable stream from async messages
const createReadableStream = (messages: AsyncIterable<StreamMessage>): ReadableStream => {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const message of messages) {
          const compressed = compressAndEncodeMessage(message)
          controller.enqueue(encoder.encode(`data: ${compressed}\n\n`))
        }
      } catch (error) {
        logger.error('Stream encoding error:', error)
      } finally {
        controller.close()
      }
    },
  })
}

// Create server->client stream response
export const createStreamResponse = (messages: AsyncIterable<StreamMessage>): Response =>
  new Response(createReadableStream(messages), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })

// Read client->server stream messages
export const readClientStream = async function* (
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<StreamMessage> {
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
}
