import { v4 as uuidv4 } from 'uuid'
import { logger } from './utils/logger'
import { createReActAgent } from './agents/react/agent'
import { DEFAULT_AGENT_CONFIG } from './agents/react/types'

// Handler functions
const handleChatRequest = async (body: any, agent: any) => {
  // Validate chat request
  if (!body.messages || !Array.isArray(body.messages)) {
    throw new Error('Invalid chat request: messages array is required')
  }

  // Process chat request
  const result = await agent.invoke({
    messages: body.messages,
    configurable: {
      thread_id: body.threadId,
      checkpoint_ns: body.configurable?.checkpoint_ns || 'default'
    }
  })
  return result
}

const handleToolRequest = async (body: any, agent: any) => {
  // Validate tool request
  if (!body.tool || typeof body.tool !== 'string' || !body.args) {
    throw new Error('Invalid tool request: tool name and args are required')
  }

  // Process tool request
  const result = await agent.invoke({
    messages: [{ type: 'tool', name: body.tool, args: body.args }],
    configurable: {
      thread_id: body.threadId,
      checkpoint_ns: body.configurable?.checkpoint_ns || 'default'
    }
  })
  return result
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
        headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Create agent
    let agent
    try {
      const configurable = {
        thread_id: threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable' as const
      }

      agent = await createReActAgent({
        modelName: DEFAULT_AGENT_CONFIG.modelName,
        host: DEFAULT_AGENT_CONFIG.host,
        threadId,
        configurable,
        maxIterations: DEFAULT_AGENT_CONFIG.maxIterations,
        userInputTimeout: DEFAULT_AGENT_CONFIG.userInputTimeout,
        safetyConfig: DEFAULT_AGENT_CONFIG.safetyConfig
      })
      logger.debug('Updated agent last access time', { threadId })
    } catch (error) {
      logger.error('Failed to create agent', { threadId, error })
      return new Response(JSON.stringify({
        error: 'Failed to initialize agent',
        details: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Process request based on path
    try {
      let result
      switch (path) {
        case '/chat':
          result = await handleChatRequest(body, agent)
          break
        case '/tool':
          result = await handleToolRequest(body, agent)
          break
        default:
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          })
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      logger.error('Error processing request', {
        threadId,
        path,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error
      })
      return new Response(JSON.stringify({
        error: 'Request processing failed',
        details: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  } catch (error) {
    logger.error('Unexpected error', {
      threadId,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    })
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export default { port: 3000, fetch: async (req: Request) => handleRequest(req) }