import { startTimer, endTimer, logUserInput, logAgentResponse, logError } from '@/logger'
import { llamautoma } from '@/ai'
import { FileTool } from '@/ai/tools/file'
import { ChatRequestSchema, SyncRequestSchema, ChatRequest, SyncRequest } from '@/types'

// Helper to create error responses
const createErrorResponse = (status: number, error: string, details?: string) => {
  return new Response(
    JSON.stringify({
      error,
      details,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

// Helper to create streaming response
const createStreamingResponse = (threadId: string, content: string) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send start event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            event: 'start',
            threadId,
            data: { content },
          })}\n\n`
        )
      )

      // Send content event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            event: 'content',
            threadId,
            data: { content },
          })}\n\n`
        )
      )

      // Send end event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            event: 'end',
            threadId,
            data: { content },
          })}\n\n`
        )
      )

      controller.close()
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

// Handler for chat requests
const handleChatRequest = async (body: ChatRequest): Promise<Response> => {
  // Validate request body
  const result = ChatRequestSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = 'Invalid chat request: messages array is required'
    logError('validation-error', errorMessage)
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  startTimer('request')
  const { messages, threadId = Bun.randomUUIDv7() } = result.data

  // Log user input
  const lastUserMessage = messages[messages.length - 1]
  logUserInput(lastUserMessage.content)

  try {
    // Process chat request
    const response = await llamautoma.invoke({
      messages,
      threadId,
    })

    const elapsedMs = endTimer('request')
    logAgentResponse('chat', response.metadata?.messages?.at(-1)?.content || '', elapsedMs)

    return createStreamingResponse(threadId, response.metadata?.messages?.at(-1)?.content || '')
  } catch (error) {
    logError('chat-error', error instanceof Error ? error.message : String(error))
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Handler for sync requests
const handleSyncRequest = async (body: SyncRequest): Promise<Response> => {
  // Validate request body
  const result = SyncRequestSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = 'Invalid sync request: root path is required'
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  const { root, excludePatterns = ['node_modules/**', 'dist/**', '.git/**'] } = result.data
  const threadId = result.data.threadId || Bun.randomUUIDv7()

  try {
    // Create file tool instance
    const fileTool = new FileTool()

    // Request all files in workspace
    const response = await fileTool.invoke({
      requestType: 'directory',
      paths: [root],
      includePattern: '**/*',
      excludePattern: excludePatterns.join('|'),
    })

    // Create a streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // Send start event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'start',
              threadId,
              data: { status: 'syncing' },
            })}\n\n`
          )
        )

        // Send file data
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'content',
              threadId,
              data: { files: JSON.parse(response) },
            })}\n\n`
          )
        )

        // Send end event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'end',
              threadId,
              data: { status: 'complete' },
            })}\n\n`
          )
        )

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    logError('sync-error', error instanceof Error ? error.message : String(error))
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Main request handler
const handleRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)

  // Validate request method
  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed')
  }

  // Parse request body
  let body: unknown
  try {
    const text = await req.text()
    body = JSON.parse(text)
  } catch (error) {
    logError('parse-error', 'Failed to parse request body')
    return createErrorResponse(400, 'Invalid JSON in request body')
  }

  // Handle request based on endpoint
  switch (url.pathname) {
    case '/v1/chat':
      return await handleChatRequest(body as ChatRequest)
    case '/v1/sync':
      return await handleSyncRequest(body as SyncRequest)
    default:
      return createErrorResponse(404, 'Not found')
  }
}

export default { port: 3000, fetch: handleRequest }
