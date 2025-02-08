import { Elysia } from 'elysia'
import { stream } from './stream'
import { llamautoma } from './ai'
import { logger } from './logger'

const app = new Elysia()

// Add middleware to handle compression
app.derive(({ request }) => {
  const acceptMsgPack = request.headers.get('Accept') === 'application/x-msgpack'
  return { acceptMsgPack }
})

app.post('/v1/chat', async ({ body, request, store }) => {
  const threadId = request.headers.get('X-Thread-ID') || 'default'
  const response = stream.createResponse(threadId)

  try {
    const generator = llamautoma.stream(body, {
      configurable: { thread_id: threadId },
    })

    const transformStream = new TransformStream()
    const writer = transformStream.writable.getWriter()
    const encoder = new TextEncoder()

    // Create new response with transformed stream
    const streamingResponse = new Response(transformStream.readable, {
      headers: response.headers,
    })

    for await (const chunk of stream.streamToClient(generator)) {
      writer.write(encoder.encode(`data: ${chunk}\n\n`))
    }

    writer.close()
    return streamingResponse
  } catch (error) {
    logger.error('Chat error:', error)
    stream.emit({
      type: 'error',
      task: 'chat',
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    })
    return response
  }
})

app.post('/v1/sync', async ({ request }) => {
  const threadId = request.headers.get('X-Thread-ID') || 'default'
  const response = stream.createResponse(threadId)

  try {
    const transformStream = new TransformStream()
    const writer = transformStream.writable.getWriter()

    // Create new response with transformed stream
    const streamingResponse = new Response(transformStream.readable, {
      headers: response.headers,
    })

    // Emit progress
    stream.emit({
      type: 'progress',
      task: 'sync',
      status: 'Starting workspace sync...',
      timestamp: Date.now(),
    })

    // TODO: Implement sync logic here
    // This is a placeholder that just emits a completion event
    stream.emit({
      type: 'complete',
      task: 'sync',
      timestamp: Date.now(),
    })

    writer.close()
    return streamingResponse
  } catch (error) {
    logger.error('Sync error:', error)
    stream.emit({
      type: 'error',
      task: 'sync',
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    })
    return response
  }
})

// Health check endpoint
app.get('/health', () => ({ status: 'ok' }))

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000
app.listen(port)
logger.info(`Server running on port ${port}`)

export default app
