import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack'
import { encode as base85Encode } from '@alttiri/base85'
import { logger } from '@/logger'
import { StreamEvent } from '@/types/stream'

/**
 * Compresses data using MessagePack + Base85
 * Handles both generic data and StreamEvents
 */
export function compressMessage(data: StreamEvent | any): Buffer {
  try {
    // First use MessagePack to serialize
    const msgpacked = msgpackEncode(data)
    // Then encode with Base85 for JSON safety if it's a StreamEvent
    if ((data as StreamEvent).type) {
      return Buffer.from(base85Encode(msgpacked))
    }
    // Otherwise just return MessagePack encoded buffer
    return Buffer.from(msgpacked)
  } catch (error) {
    logger.error('Error compressing message:', error)
    throw new Error('Failed to compress message')
  }
}

/**
 * Decompresses MessagePack data
 */
function decompressMessage(data: Buffer): any {
  try {
    return msgpackDecode(data)
  } catch (error) {
    logger.error('Error decompressing message:', error)
    throw new Error('Failed to decompress message')
  }
}

/**
 * Middleware to decompress incoming requests
 */
export async function decompressRequest(req: Request): Promise<Response> {
  if (req.headers.get('content-type') === 'application/x-msgpack') {
    const buffer = await req.arrayBuffer()
    try {
      const body = decompressMessage(Buffer.from(buffer))
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(String(error), { status: 400 })
    }
  }
  const blob = await req.blob()
  return new Response(blob, {
    headers: req.headers,
  })
}

/**
 * Middleware to compress outgoing responses
 */
export function compressResponse(res: Response, acceptMsgPack: boolean): Response {
  if (!acceptMsgPack) return res

  const reader = res.body?.getReader()
  const stream = new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.close()
        return
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = new TextDecoder().decode(value)
          const compressed = compressMessage(JSON.parse(text))
          controller.enqueue(compressed)
        }
      } finally {
        reader.releaseLock()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-msgpack',
      ...res.headers,
    },
  })
}

/**
 * Helper to compress SSE events with MessagePack
 */
export function compressSSEEvent(event: string, data: any): string {
  const msgpacked = msgpackEncode(data)
  const encoded = base85Encode(msgpacked)
  return `event: ${event}\ndata: msgpack:${encoded}\n\n`
}

/**
 * Helper to create a compressed SSE response
 */
export function createCompressedSSEResponse(): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('retry: 1000\n\n'))
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
