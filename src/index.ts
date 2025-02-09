import { Elysia } from 'elysia'
import { createServerResponse, type ServerToClientMessage } from '@/stream'
import { llamautoma } from '@/ai'
import { logger } from '@/logger'

// Create server instance
const app = new Elysia()

// Error response helper
const errorResponse = (error: unknown, status = 500) =>
  new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// Handle chat requests
app.post('/v1/chat', async ({ body, request }) => {
  try {
    const threadId = request.headers.get('X-Thread-ID')
    const stream = await llamautoma.stream(body, { configurable: { threadId } })
    return createServerResponse(stream)
  } catch (error) {
    logger.error({ error }, 'Chat request failed')
    return errorResponse(error)
  }
})

// Health check endpoint
app.get('/health', () => ({ status: 'ok' }))

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000
app.listen(port)
logger.info(`Server listening on port ${port}`)

export default app
