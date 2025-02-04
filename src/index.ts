import {
  startTimer,
  endTimer,
  logUserInput,
  logAgentResponse,
  logRequest,
  logResponse,
  logError,
} from '@/logger'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG, ChatRequestSchema, SyncRequestSchema } from '@/types/agent'

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
const handleChatRequest = async (body: unknown, agent: any) => {
  // Validate request body
  const result = ChatRequestSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = 'Invalid chat request: messages array is required'
    logError('validation-error', errorMessage)
    return createErrorResponse(500, 'Request failed', errorMessage)
  }

  const { messages, threadId = Bun.randomUUIDv7(), safetyConfig, configurable } = result.data
  startTimer(threadId)

  // Log user input
  const lastUserMessage = messages[messages.length - 1]
  logUserInput(threadId, lastUserMessage.content)

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    logError(threadId, 'Input exceeds maximum length')
    return createErrorResponse(400, 'Input exceeds maximum length')
  }

  try {
    // Process chat request
    const result = await agent.invoke(
      {
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
    )

    const response = result.messages[result.messages.length - 1].content
    const elapsedMs = endTimer(threadId)
    logAgentResponse(threadId, 'chat', response, elapsedMs)

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

  const { messages, threadId = Bun.randomUUIDv7(), safetyConfig, configurable } = result.data

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    return createErrorResponse(400, 'Input exceeds maximum length')
  }

  try {
    // Process edit request
    const result = await agent.invoke(
      {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        configurable: {
          thread_id: threadId,
          checkpoint_ns: 'react_agent',
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
    )

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

  const { messages, threadId = Bun.randomUUIDv7(), safetyConfig, configurable } = result.data

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    return createErrorResponse(400, 'Input exceeds maximum length')
  }

  try {
    // Process compose request
    const result = await agent.invoke(
      {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        configurable: {
          thread_id: threadId,
          checkpoint_ns: 'react_agent',
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
    )

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
  const threadId = Bun.randomUUIDv7()
  const url = new URL(req.url)

  logRequest(threadId, req.method, url.pathname, req.body)
  startTimer(threadId)

  try {
    // Validate request method
    if (req.method !== 'POST') {
      return createErrorResponse(405, 'Method not allowed')
    }

    // Parse request body
    let body: unknown
    try {
      body = await req.json()
    } catch (error) {
      logError(threadId, 'Failed to parse request body', { error })
      return createErrorResponse(400, 'Invalid JSON in request body')
    }

    // Create agent
    let agent
    try {
      // Override thread ID if provided in request
      const requestThreadId = (body as any).threadId
      const finalThreadId = requestThreadId || threadId

      agent = createReActAgent({
        threadId: finalThreadId,
        ...((body as any).config || {}),
      })
    } catch (error) {
      logError(threadId, 'Failed to create agent', { error })
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

    const elapsedMs = endTimer(threadId) || 0
    logResponse(threadId, url.pathname, response.status, elapsedMs)
    return response
  } catch (error) {
    logError(threadId, error instanceof Error ? error.message : String(error))
    return createErrorResponse(
      500,
      'Request failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export default { port: 3000, fetch: handleRequest }
