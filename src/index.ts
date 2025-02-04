import { startTimer, endTimer, logUserInput, logAgentResponse, logError } from '@/logger'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG, ChatRequestSchema, SyncRequestSchema, ChatRequest } from '@/types'

type Agent = ReturnType<typeof createReActAgent>

// Stream event encoder
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

// Helper to create JSON response
const createJsonResponse = (data: any) => {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

// Handler for chat requests
const handleChatRequest = async (body: ChatRequest, agent: Agent) => {
  // Log raw request body
  console.log('Raw chat request body:', body)

  // Validate request body
  const result = ChatRequestSchema.safeParse(body)
  console.log('Validation result:', result)

  if (!result.success) {
    const errorMessage = 'Invalid chat request: messages array is required'
    console.log('Validation error:', result.error)
    logError('validation-error', errorMessage)
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  startTimer('request')
  const { messages } = result.data

  // Log user input
  const lastUserMessage = messages[messages.length - 1]
  logUserInput(lastUserMessage.content)

  try {
    // Process chat request
    const result = await agent.invoke({
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
              configurable: {
          thread_id: threadId,
          checkpoint_ns: configurable?.checkpoint_ns || 'react_agent',
          [Symbol.toStringTag]: 'AgentConfigurable',
        },
      },
      {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: configurable?.checkpoint_ns || 'react_agent',
          [Symbol.toStringTag]: 'AgentConfigurable',
        },
      }
    })

    const response = result.messages[result.messages.length - 1].content
    const elapsedMs = endTimer('request')
    logAgentResponse('chat', response, elapsedMs)

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
              data: { content: response },
            })}\n\n`
          )
        )

        // Send content event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'content',
              threadId,
              data: { content: response },
            })}\n\n`
          )
        )

        // Send end event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'end',
              threadId,
              data: { content: response },
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
    logError(threadId, error instanceof Error ? error.message : String(error))
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Handler for edit requests
const handleEditRequest = async (body: unknown, agent: any) => {
  // Validate request body
  const result = ChatRequestSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = 'Invalid edit request: messages array is required'
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  const { messages, threadId = Bun.randomUUIDv7(), safetyConfig } = result.data

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    return createErrorResponse(400, 'Input exceeds maximum length')
  }

  try {
    // Process edit request
    const result = await agent.invoke({
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      threadId,
    })

    // Return response in client's expected format
    return createJsonResponse({
      edits: [
        {
          file: 'test.ts',
          content: result.messages[result.messages.length - 1].content,
        },
      ],
    })
  } catch (error) {
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Handler for compose requests
const handleComposeRequest = async (body: unknown, agent: any) => {
  // Validate request body
  const result = ChatRequestSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = 'Invalid compose request: messages array is required'
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  const { messages, threadId = Bun.randomUUIDv7(), safetyConfig } = result.data

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    return createErrorResponse(400, 'Input exceeds maximum length')
  }

  try {
    // Process compose request
    const result = await agent.invoke({
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      threadId,
    })

    // Return response in client's expected format
    return createJsonResponse({
      files: [
        {
          path: 'test.ts',
          content: result.messages[result.messages.length - 1].content,
        },
      ],
    })
  } catch (error) {
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Handler for sync requests
const handleSyncRequest = async (body: unknown) => {
  // Validate request body
  const result = SyncRequestSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = 'Invalid sync request: root path is required'
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  try {
    // Return success response
    return createJsonResponse({
      status: 'success',
    })
  } catch (error) {
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
  console.log('Incoming request:', {
    method: req.method,
    url: url.toString(),
    headers: Object.fromEntries(req.headers.entries()),
  })

  // Validate request method
  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed')
  }

  // Parse request body
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    console.log('Raw request text:', text)
    body = JSON.parse(text)
    console.log('Parsed request body:', body)
  } catch (error) {
    console.error('Body parsing error:', error)
    logError('parse-error', 'Failed to parse request body', { error })
    return createErrorResponse(400, 'Invalid JSON in request body')
  }

  // Create agent with proper configuration
  let agent
  try {
    agent = createReActAgent({
      ...body.config,
    })
  } catch (error) {
    logError('agent-error', 'Failed to create agent', { error })
    return createErrorResponse(500, 'Failed to create agent')
  }

  // Handle request based on endpoint
  let response: Response
  switch (url.pathname) {
    case '/v1/chat':
      response = await handleChatRequest(body, agent)
      break
    case '/v1/edit':
      response = await handleEditRequest(body, agent)
      break
    case '/v1/compose':
      response = await handleComposeRequest(body, agent)
      break
    case '/v1/sync':
      response = await handleSyncRequest(body)
      break
    default:
      response = createErrorResponse(404, 'Not found')
  }

  return response
}

export default { port: 3000, fetch: handleRequest }
