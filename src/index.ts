import { Elysia } from 'elysia'
import { stream, Stream } from './stream'
import { llamautoma } from './ai'
import { logger } from './logger'

/**
 * Create a generator for sync events
 */
async function* createSyncGenerator() {
  // Emit progress
  yield {
    type: 'progress',
    task: 'sync',
    status: 'Starting workspace sync...',
    timestamp: Date.now(),
  }

  // TODO: Implement sync logic here
  // This is a placeholder that just emits a completion event
  yield {
    type: 'complete',
    task: 'sync',
    timestamp: Date.now(),
  }
}

/**
 * Handle stream errors by emitting error events
 */
function createErrorHandler(stream: Stream, task: string) {
  return (error: Error) => {
    stream.emit({
      type: 'error',
      task,
      error: error.message,
      timestamp: Date.now(),
    })
  }
}

const app = new Elysia()

// Add middleware to handle compression
app.derive(({ request }) => {
  const acceptMsgPack = request.headers.get('Accept') === 'application/x-msgpack'
  return { acceptMsgPack }
})

// Chat endpoint
app.post('/v1/chat', async ({ body, request }) => {
  const threadId = request.headers.get('X-Thread-ID') || 'default'

  try {
    const generator = llamautoma.stream(body, {
      configurable: { thread_id: threadId },
    })

    return stream.createStreamHandler(generator, threadId, createErrorHandler(stream, 'chat'))
  } catch (error) {
    logger.error('Chat error:', error)
    const response = stream.createResponse(threadId)
    stream.emit({
      type: 'error',
      task: 'chat',
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    })
    return response
  }
})

// Sync endpoint
app.post('/v1/sync', async ({ request }) => {
  const threadId = request.headers.get('X-Thread-ID') || 'default'

  try {
    return stream.createStreamHandler(
      createSyncGenerator(),
      threadId,
      createErrorHandler(stream, 'sync')
    )
  } catch (error) {
    logger.error('Sync error:', error)
    const response = stream.createResponse(threadId)
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
