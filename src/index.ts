import { v4 as uuidv4 } from 'uuid'
import { logger } from '@/logger'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'

// Handler functions
const handleChatRequest = async (body: any, agent: any) => {
  // Validate chat request
  if (!body.messages || !Array.isArray(body.messages)) {
    throw new Error('Invalid chat request: messages array is required')
  }

  // Validate input length
  const totalLength = body.messages.reduce(
    (acc: number, msg: any) => acc + (msg.content?.length || 0),
    0
  )
  if (
    totalLength >
    (body.safetyConfig?.maxInputLength || DEFAULT_AGENT_CONFIG.safetyConfig.maxInputLength)
  ) {
    return new Response(JSON.stringify({ error: 'Input exceeds maximum length' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Generate thread_id if not provided
  const threadId = body.threadId || uuidv4()

  // Create a ReadableStream for SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial message
        const startEvent = `data: ${JSON.stringify({ event: 'start', threadId })}\n\n`
        controller.enqueue(encoder.encode(startEvent))

        // Process chat request
        const result = await agent.invoke(
          {
            messages: body.messages.map((msg: any) => ({
              role: msg.role || 'user',
              content: msg.content,
            })),
            configurable: {
              thread_id: threadId,
              checkpoint_ns: body.configurable?.checkpoint_ns || 'default',
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
          const messageEvent = `data: ${JSON.stringify({
            event: 'message',
            data: {
              type: message.type,
              content: message.content,
              threadId,
            },
          })}\n\n`
          controller.enqueue(encoder.encode(messageEvent))
        }

        // Send final message
        const endEvent = `data: ${JSON.stringify({ event: 'end', threadId })}\n\n`
        controller.enqueue(encoder.encode(endEvent))
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({
          event: 'error',
          error: error instanceof Error ? error.message : String(error),
          threadId,
        })}\n\n`
        controller.enqueue(encoder.encode(errorEvent))
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

const handleToolRequest = async (body: any, agent: any) => {
  // Validate tool request
  if (!body.name || typeof body.name !== 'string') {
    throw new Error('Tool name is required')
  }

  // Generate thread_id if not provided
  const threadId = body.threadId || uuidv4()

  // Process tool request
  const result = await agent.invoke(
    {
      messages: [
        {
          role: 'user',
          type: 'tool',
          name: body.name,
          args: body.args || {},
        },
      ],
      configurable: {
        thread_id: threadId,
        checkpoint_ns: body.configurable?.checkpoint_ns || 'default',
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

  // Return tool registration response
  return new Response(
    JSON.stringify({
      success: true,
      toolId: threadId,
      message: 'Tool registered successfully',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

const handleRequest = async (req: Request): Promise<Response> => {
  const threadId = uuidv4()
  logger.debug('Created new agent', { threadId })

  try {
    const url = new URL(req.url)
    const path = url.pathname.toLowerCase()

    // Validate request method
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse request body
    let body
    try {
      body = await req.json()
    } catch (error) {
      logger.error('Failed to parse request body', { threadId, error })
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
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
        modelName: body.modelName || DEFAULT_AGENT_CONFIG.modelName,
        host: body.host || DEFAULT_AGENT_CONFIG.host,
        threadId,
        configurable,
        maxIterations: DEFAULT_AGENT_CONFIG.maxIterations,
        userInputTimeout: DEFAULT_AGENT_CONFIG.userInputTimeout,
        safetyConfig: body.safetyConfig || DEFAULT_AGENT_CONFIG.safetyConfig,
      })
      logger.debug('Updated agent last access time', { threadId })
    } catch (error) {
      logger.error('Failed to create agent', { threadId, error })
      return new Response(
        JSON.stringify({
          error: 'Failed to initialize agent',
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Process request based on path
    try {
      switch (path) {
        case '/chat':
          return await handleChatRequest(body, agent)
        case '/tool':
          return await handleToolRequest(body, agent)
        default:
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
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
      return new Response(
        JSON.stringify({
          error: 'Request processing failed',
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
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
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export default { port: 3000, fetch: handleRequest }