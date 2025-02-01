import { Serve } from 'bun'
import { entrypoint, task, MemorySaver } from '@langchain/langgraph'
import { ReActAgent } from '../agents/react/agent'
import { MemoryManager } from '../agents/react/memory/memoryManager'
import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { AgentOutput } from '../agents/react/types'
import { z } from 'zod'
import pino from 'pino'

const logger = pino({
  name: 'server',
  level: process.env.LOG_LEVEL || 'info',
})

// Request types
const MessageSchema = z.object({
  role: z.enum(['user', 'system', 'assistant']),
  content: z.string(),
})

const ChatRequest = z.object({
  messages: z.array(MessageSchema),
  threadId: z.string(),
})

const EmbedRequest = z.object({
  type: z.string(),
  path: z.string(),
  content: z.string(),
})

const EditRequest = z.object({
  file: z.string(),
  prompt: z.string(),
  threadId: z.string(),
})

const ComposeRequest = z.object({
  prompt: z.string(),
  threadId: z.string(),
})

const ToolExecuteRequest = z.object({
  toolId: z.string(),
  input: z.unknown(),
  threadId: z.string(),
})

const ToolRegistrationRequest = z.object({
  name: z.string(),
  description: z.string(),
  schema: z.object({
    type: z.string(),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
})

// Response types
const EmbeddingResponse = z.object({
  success: z.boolean(),
  embeddings: z.array(z.number()),
})

const ToolRegistrationResponse = z.object({
  success: z.boolean(),
  toolId: z.string(),
})

type ServerConfig = {
  agent: ReActAgent
  memory: MemoryManager
  port: number
}

export class Server {
  private server: ReturnType<typeof Bun.serve> | null = null
  private agent: ReActAgent
  private memory: MemoryManager
  private port: number
  private checkpointer: MemorySaver

  constructor(config: ServerConfig) {
    this.agent = config.agent
    this.memory = config.memory
    this.port = config.port
    this.checkpointer = new MemorySaver()
  }

  async start() {
    this.server = Bun.serve({
      port: this.port,
      fetch: async (req: Request) => {
        const url = new URL(req.url)

        try {
          switch (url.pathname) {
            case '/chat':
              return await this.handleChat(req)
            case '/embed':
              return await this.handleEmbed(req)
            case '/edit':
              return await this.handleEdit(req)
            case '/compose':
              return await this.handleCompose(req)
            case '/tools':
              return await this.handleToolRegistration(req)
            case '/tools/execute':
              return await this.handleToolExecution(req)
            default:
              return new Response('Not Found', { status: 404 })
          }
        } catch (error) {
          logger.error('Error handling request:', error)
          return new Response('Internal Server Error', { status: 500 })
        }
      },
    })

    logger.info(`Server started on port ${this.port}`)
  }

  async stop() {
    if (this.server) {
      this.server.stop()
      this.server = null
      logger.info('Server stopped')
    }
  }

  private messageToBaseMessage(message: z.infer<typeof MessageSchema>): BaseMessage {
    switch (message.role) {
      case 'user':
        return new HumanMessage(message.content)
      case 'system':
        return new SystemMessage(message.content)
      case 'assistant':
        return new AIMessage(message.content)
      default:
        throw new Error(`Unknown message role: ${message.role}`)
    }
  }

  private async handleChat(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { messages, threadId } = ChatRequest.parse(body)
    const baseMessages = messages.map((msg) => this.messageToBaseMessage(msg))

    const workflow = entrypoint(
      { checkpointer: this.checkpointer, name: 'chat' },
      async (inputs: { messages: BaseMessage[] }): Promise<AgentOutput> => {
        const result = await this.agent.execute(inputs.messages)
        return {
          messages: [...inputs.messages, new AIMessage(result.content || '')],
          status: result.success ? 'continue' : 'end',
          toolFeedback: {},
          iterations: 1,
          threadId,
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'chat',
          },
        }
      }
    )

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await workflow.invoke(
            { messages: baseMessages },
            {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: 'chat',
              },
            }
          )

          controller.enqueue(`data: ${JSON.stringify(result)}\n\n`)
          controller.close()
        } catch (error) {
          controller.error(error)
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

  private async handleEmbed(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { type, path, content } = EmbedRequest.parse(body)

    // Use LangGraph's task for embedding
    const embed = task('embed', async (input: string) => {
      // TODO: Implement actual embedding logic using a vector store
      return Array.from({ length: 384 }, () => Math.random()) // Mock embeddings for now
    })

    const result = await embed(content)
    return new Response(
      JSON.stringify(
        EmbeddingResponse.parse({
          success: true,
          embeddings: result,
        })
      ),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async handleEdit(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { file, prompt, threadId } = EditRequest.parse(body)

    const workflow = entrypoint(
      { checkpointer: this.checkpointer, name: 'edit' },
      async (inputs: { prompt: string }): Promise<AgentOutput> => {
        const result = await this.agent.execute([new HumanMessage(`Edit file ${file}: ${prompt}`)])
        return {
          messages: [new AIMessage(result.content || '')],
          status: result.success ? 'continue' : 'end',
          toolFeedback: {},
          iterations: 1,
          threadId,
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'edit',
          },
        }
      }
    )

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await workflow.invoke(
            { prompt },
            {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: 'edit',
              },
            }
          )

          controller.enqueue(`data: ${JSON.stringify({ type: 'edit', ...result })}\n\n`)
          controller.close()
        } catch (error) {
          controller.error(error)
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

  private async handleCompose(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { prompt, threadId } = ComposeRequest.parse(body)

    const workflow = entrypoint(
      { checkpointer: this.checkpointer, name: 'compose' },
      async (inputs: { prompt: string }): Promise<AgentOutput> => {
        const result = await this.agent.execute([new HumanMessage(`Compose new file: ${prompt}`)])
        return {
          messages: [new AIMessage(result.content || '')],
          status: result.success ? 'continue' : 'end',
          toolFeedback: {},
          iterations: 1,
          threadId,
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'compose',
          },
        }
      }
    )

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await workflow.invoke(
            { prompt },
            {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: 'compose',
              },
            }
          )

          controller.enqueue(`data: ${JSON.stringify({ type: 'compose', ...result })}\n\n`)
          controller.close()
        } catch (error) {
          controller.error(error)
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

  private async handleToolRegistration(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { name, description, schema } = ToolRegistrationRequest.parse(body)

    // TODO: Implement actual tool registration logic
    const toolId = crypto.randomUUID()

    return new Response(
      JSON.stringify(
        ToolRegistrationResponse.parse({
          success: true,
          toolId,
        })
      ),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async handleToolExecution(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const { toolId, input, threadId } = ToolExecuteRequest.parse(body)

    const workflow = entrypoint(
      { checkpointer: this.checkpointer, name: 'tool-execution' },
      async (inputs: { toolId: string; input: unknown }): Promise<AgentOutput> => {
        // TODO: Implement actual tool execution logic
        const result = await this.agent.execute([
          new HumanMessage(`Execute tool ${toolId} with input: ${JSON.stringify(input)}`),
        ])
        return {
          messages: [new AIMessage(result.content || '')],
          status: result.success ? 'continue' : 'end',
          toolFeedback: {},
          iterations: 1,
          threadId,
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'tool-execution',
          },
        }
      }
    )

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await workflow.invoke(
            { toolId, input },
            {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: 'tool-execution',
              },
            }
          )

          controller.enqueue(`data: ${JSON.stringify(result)}\n\n`)
          controller.close()
        } catch (error) {
          controller.error(error)
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
}
