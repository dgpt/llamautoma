import { Elysia } from 'elysia'
import { createServerResponse } from '@/stream'
import { llamautoma } from '@/ai'
import { logger } from '@/logger'
import { DEFAULT_CONFIG } from '@/config'
import { ChatRequestSchema } from '@/types'

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
    // Validate and parse request body
    const parsedBody = ChatRequestSchema.parse(body)

    // Merge request config with defaults
    const config = {
      ...DEFAULT_CONFIG,
      ...parsedBody,
      models: {
        ...DEFAULT_CONFIG.models,
        ...parsedBody.models,
      },
      server: {
        ...DEFAULT_CONFIG.server,
        ...parsedBody.server,
      },
      memory: {
        ...DEFAULT_CONFIG.memory,
        ...parsedBody.memory,
      },
      safety: {
        ...DEFAULT_CONFIG.safety,
        ...parsedBody.safety,
      },
      tools: {
        ...DEFAULT_CONFIG.tools,
        ...parsedBody.tools,
      },
    }

    const threadId = request.headers.get('X-Thread-ID')
    const stream = await llamautoma.stream(
      { ...parsedBody, config },
      { configurable: { threadId } }
    )
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
