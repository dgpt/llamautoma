import { Elysia } from 'elysia'
import { createStreamResponse } from '@/stream'
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

// Chat endpoint - handles all AI interactions
app.post('/v1/chat', async ({ request }) => {
  try {
    const body = await request.json()
    const threadId = request.headers.get('X-Thread-ID')
    const stream = llamautoma.stream(body, { threadId })
    return createStreamResponse(stream)
  } catch (error) {
    logger.error('Chat error:', error)
    return errorResponse(error)
  }
})

// Sync endpoint - handles workspace synchronization
app.post('/v1/sync', async ({ request }) => {
  try {
    const body = await request.json()
    const stream = llamautoma.sync(body)
    return createStreamResponse(stream)
  } catch (error) {
    logger.error('Sync error:', error)
    return errorResponse(error)
  }
})

// Health check endpoint
app.get('/health', () => ({ status: 'ok' }))

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000
app.listen(port)
logger.info(`Server running on port ${port}`)

export default app
