import { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { logger } from './utils/logger'
import { LlamautomaClient } from './client'

const RequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    messages: z.array(z.object({
      role: z.enum(['user', 'system', 'assistant']),
      content: z.string(),
    })),
    threadId: z.string().optional(),
    modelName: z.string().optional(),
    host: z.string().optional(),
  }),
  z.object({
    type: z.literal('edit'),
    file: z.string(),
    prompt: z.string(),
    threadId: z.string().optional(),
    modelName: z.string().optional(),
    host: z.string().optional(),
  }),
  z.object({
    type: z.literal('compose'),
    prompt: z.string(),
    threadId: z.string().optional(),
    modelName: z.string().optional(),
    host: z.string().optional(),
  }),
  z.object({
    type: z.literal('embed'),
    path: z.string(),
    content: z.string(),
    threadId: z.string().optional(),
    modelName: z.string().optional(),
    host: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool'),
    name: z.string(),
    description: z.string(),
    schema: z.object({
      type: z.string(),
      properties: z.record(z.unknown()),
      required: z.array(z.string()).optional(),
    }),
  }),
])

export class Server {
  private server: ReturnType<typeof Bun.serve> | null = null
  private client: LlamautomaClient
  private port: number
  private registeredTools: Map<string, Tool> = new Map()

  constructor(config: {
    port: number
    modelName?: string
    host?: string
    tools?: Tool[]
  }) {
    this.port = config.port
    this.client = new LlamautomaClient(config.tools || [])
    if (config.tools) {
      config.tools.forEach(tool => this.registeredTools.set(tool.name, tool))
    }
  }

  private createStream(stream: AsyncIterableIterator<any>): ReadableStream {
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const message of stream) {
            controller.enqueue(`data: ${JSON.stringify({ messages: [message] })}\n\n`)
          }
          controller.close()
        } catch (error) {
          logger.error('Error in stream:', error)
          controller.error(error)
        }
      },
    })
  }

  private async handleRequest(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    try {
      const body = await req.json()
      const validatedBody = RequestSchema.parse(body)
      const threadId = 'threadId' in validatedBody ? validatedBody.threadId || uuidv4() : uuidv4()
      const modelName = 'modelName' in validatedBody ? validatedBody.modelName : undefined
      const host = 'host' in validatedBody ? validatedBody.host : undefined

      const options = {
        stream: true,
        threadId,
        modelName,
        host,
        tools: Array.from(this.registeredTools.values())
      }

      let response
      switch (validatedBody.type) {
        case 'chat':
          response = await this.client.chat(validatedBody.messages[0].content, options)
          break
        case 'edit':
          response = await this.client.edit(validatedBody.prompt, validatedBody.file)
          break
        case 'compose':
          response = await this.client.compose(validatedBody.prompt)
          break
        case 'embed':
          response = await this.client.sync(validatedBody.path)
          break
        case 'tool':
          return new Response(JSON.stringify({ success: true, toolId: uuidv4() }), {
            headers: { 'Content-Type': 'application/json' },
          })
        default:
          return new Response('Invalid request type', { status: 400 })
      }

      if (response.stream) {
        const stream = this.createStream(response.stream)
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      logger.error('Error handling request:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return new Response(JSON.stringify({
        status: 'error',
        error: errorMessage
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  async start() {
    try {
      this.server = Bun.serve({
        port: this.port,
        fetch: this.handleRequest.bind(this),
      })
      logger.info(`Server started on port ${this.port}`)
    } catch (error) {
      logger.error('Failed to start server:', error)
      throw error
    }
  }

  async stop() {
    if (this.server) {
      try {
        this.server.stop()
        this.server = null
        logger.info('Server stopped')
      } catch (error) {
        logger.error('Failed to stop server:', error)
        throw error
      }
    }
  }
}