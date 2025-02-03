import { v4 as uuidv4 } from 'uuid'
import { logger } from '@/logger'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { z } from 'zod'

// Request validation schemas
const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ),
  threadId: z.string().optional(),
  modelName: z.string().optional(),
  host: z.string().optional(),
  safetyConfig: z
    .object({
      requireToolConfirmation: z.boolean().optional(),
      requireToolFeedback: z.boolean().optional(),
      maxInputLength: z.number().optional(),
      dangerousToolPatterns: z.array(z.string()).optional(),
    })
    .optional(),
  configurable: z
    .object({
      checkpoint_ns: z.string().optional(),
    })
    .optional(),
})

const ToolRequestSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()).optional(),
  threadId: z.string().optional(),
  configurable: z
    .object({
      checkpoint_ns: z.string().optional(),
    })
    .optional(),
})

// Stream event encoder
const encoder = new TextEncoder()

// Helper to create SSE messages
const createSSEMessage = (event: string, data: unknown, threadId: string) => {
  return `data: ${JSON.stringify({ event, threadId, data })}\n\n`
}

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

// Handler for chat requests
const handleChatRequest = async (body: unknown, agent: any) => {
  // Validate request body
  const result = ChatRequestSchema.safeParse(body)
  if (!result.success) {
    throw new Error('Invalid chat request: ' + result.error.message)
  }

  const { messages, threadId = uuidv4(), safetyConfig, configurable } = result.data

  // Validate input length
  const totalLength = messages.reduce((acc, msg) => acc + msg.content.length, 0)
  const maxLength = safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength
  if (totalLength > maxLength) {
    throw new Error('Input exceeds maximum length')
  }

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial message
        controller.enqueue(encoder.encode(createSSEMessage('start', null, threadId)))

        // Process chat request
        const result = await agent.invoke(
          {
            messages: messages.map(msg => ({
              role: msg.role,
              content: msg.content,
            })),
            configurable: {
              thread_id: threadId,
              checkpoint_ns: configurable?.checkpoint_ns || 'default',
              [Symbol.toStringTag]: 'AgentConfigurable',
            },
          },
          {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: 'react_agent',
              [Symbol.toStringTag]: 'AgentConfigurable',
            },
          }
        )

        // Send messages
        for (const message of result.messages) {
          controller.enqueue(
            encoder.encode(
              createSSEMessage(
                'message',
                {
                  type: message.type,
                  content: message.content,
                },
                threadId
              )
            )
          )
        }

        // Send final message
        controller.enqueue(encoder.encode(createSSEMessage('end', null, threadId)))
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            createSSEMessage(
              'error',
              { error: error instanceof Error ? error.message : String(error) },
              threadId
            )
          )
        )
      } finally {
        controller.close()
      }
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

// Handler for tool requests
const handleToolRequest = async (body: unknown, agent: any) => {
  // Validate tool request
  const result = ToolRequestSchema.safeParse(body)
  if (!result.success) {
    throw new Error('Invalid tool request: ' + result.error.message)
  }

  const { name, args = {}, threadId = uuidv4(), configurable } = result.data

  // Process tool request
  const toolResult = await agent.invoke(
    {
      messages: [
        {
          role: 'user',
          type: 'tool',
          name,
          args,
        },
      ],
      configurable: {
        thread_id: threadId,
        checkpoint_ns: configurable?.checkpoint_ns || 'default',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
    },
    {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
    }
  )

  return new Response(
    JSON.stringify({
      success: true,
      toolId: threadId,
      message: 'Tool registered successfully',
      result: toolResult,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

// Main request handler
const handleRequest = async (req: Request): Promise<Response> => {
  const threadId = uuidv4()
  logger.debug('Processing request', { threadId })

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
      logger.error('Failed to parse request body', { threadId, error })
      return createErrorResponse(400, 'Invalid JSON in request body')
    }

    // Create agent
    let agent
    try {
      const configurable = {
        thread_id: threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable' as const,
      }

      agent = await createReActAgent({
        modelName: (body as any).modelName || DEFAULT_AGENT_CONFIG.modelName,
        host: (body as any).host || DEFAULT_AGENT_CONFIG.host,
        threadId,
        configurable,
        maxIterations: DEFAULT_AGENT_CONFIG.maxIterations,
        userInputTimeout: DEFAULT_AGENT_CONFIG.userInputTimeout,
        safetyConfig: (body as any).safetyConfig || DEFAULT_AGENT_CONFIG.safetyConfig,
      })
      logger.debug('Agent created successfully', { threadId })
    } catch (error) {
      logger.error('Failed to create agent', { threadId, error })
      return createErrorResponse(
        500,
        'Failed to initialize agent',
        error instanceof Error ? error.message : String(error)
      )
    }

    // Route request based on path
    const url = new URL(req.url)
    const path = url.pathname.toLowerCase()

    try {
      switch (path) {
        case '/chat':
          return await handleChatRequest(body, agent)
        case '/tool':
          return await handleToolRequest(body, agent)
        default:
          return createErrorResponse(404, 'Not found')
      }
    } catch (error) {
      logger.error('Error processing request', {
        threadId,
        path,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
      })
      return createErrorResponse(
        500,
        'Request processing failed',
        error instanceof Error ? error.message : String(error)
      )
    }
  } catch (error) {
    logger.error('Unexpected error', {
      threadId,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    })
    return createErrorResponse(
      500,
      'Internal server error',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export default { port: 3000, fetch: handleRequest }