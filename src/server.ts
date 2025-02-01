import { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { logger } from './utils/logger'
import { LlamautomaClient } from './client'
import { Configurable } from './agents/react/types/langgraph'

const RequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    messages: z.array(z.object({
      role: z.enum(['user', 'system', 'assistant']),
      content: z.string(),
    })).min(1),
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
    content: z.string().optional(),
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
    logger.debug('Creating server stream');
    const iterator = stream[Symbol.asyncIterator]();
    let isDone = false;
    const sink = new Bun.ArrayBufferSink();
    sink.start({
      stream: true,
      asUint8Array: true,
      highWaterMark: 500 * 1024 * 1024, // 500MB buffer
    });
    logger.debug('ArrayBufferSink initialized');

    return new ReadableStream({
      async pull(controller) {
        try {
          if (isDone) {
            logger.debug('Stream marked as done, flushing final buffer');
            const finalBuffer = sink.flush();
            if (finalBuffer instanceof Uint8Array && finalBuffer.byteLength > 0) {
              logger.debug({ byteLength: finalBuffer.byteLength }, 'Enqueueing final buffer');
              controller.enqueue(new TextDecoder().decode(finalBuffer));
            }
            logger.debug('Closing stream controller');
            controller.close();
            return;
          }

          logger.debug('Pulling next value from iterator');
          const { value, done } = await iterator.next();
          if (done) {
            logger.debug('Iterator completed');
            isDone = true;
            const finalBuffer = sink.flush();
            if (finalBuffer instanceof Uint8Array && finalBuffer.byteLength > 0) {
              logger.debug({ byteLength: finalBuffer.byteLength }, 'Enqueueing final buffer after completion');
              controller.enqueue(new TextDecoder().decode(finalBuffer));
            }
            logger.debug('Closing stream controller after completion');
            controller.close();
            return;
          }

          const chunk = `data: ${JSON.stringify({ messages: [value] })}\n\n`;
          logger.debug({ chunkLength: chunk.length }, 'Writing chunk to sink');
          sink.write(chunk);

          // Flush the buffer if it has content
          const buffer = sink.flush();
          if (buffer instanceof Uint8Array && buffer.byteLength > 0) {
            logger.debug({ byteLength: buffer.byteLength }, 'Flushing and enqueueing buffer');
            controller.enqueue(new TextDecoder().decode(buffer));
          } else {
            logger.debug('No data to flush from buffer');
          }
        } catch (error) {
          logger.error({ error }, 'Error in stream processing');
          controller.error(error);
          isDone = true;
        }
      },
      cancel() {
        logger.debug('Stream cancelled, cleaning up');
        isDone = true;
        // Ensure cleanup of any resources
        if (iterator.return) {
          logger.debug('Calling iterator.return()');
          iterator.return();
        }
      }
    });
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

      const configurable: Configurable = {
        thread_id: threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable' as const
      }

      const options = {
        stream: true,
        threadId,
        modelName,
        host,
        tools: Array.from(this.registeredTools.values()),
        configurable
      }

      let response
      try {
        switch (validatedBody.type) {
          case 'chat':
            response = await this.client.chat(validatedBody.messages[0].content, options)
            break
          case 'edit':
            response = await this.client.edit(validatedBody.prompt, validatedBody.file, options)
            break
          case 'compose':
            response = await this.client.compose(validatedBody.prompt, options)
            break
          case 'embed':
            response = await this.client.sync(validatedBody.path, options)
            break
          case 'tool':
            return new Response(JSON.stringify({ success: true, toolId: uuidv4() }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200
            })
          default:
            return new Response('Invalid request type', { status: 400 })
        }

        if (response.stream) {
          logger.debug('Response contains stream, creating server stream');
          const stream = this.createStream(response.stream);
          logger.debug('Server stream created, returning response');
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no'
            },
            status: 200
          });
        }

        logger.debug('Response does not contain stream, returning JSON response');
        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      } catch (error) {
        logger.error('Error executing request:', error)
        return new Response(JSON.stringify({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    } catch (error) {
      logger.error('Error parsing request:', error)
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