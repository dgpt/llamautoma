import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { compressAndEncodeMessage, decodeAndDecompressMessage } from '@/lib/compression'
import { logger } from '@/logger'
import { createStreamResponse } from '@/stream'
import type { StreamMessage } from '@/stream'

const commandInputSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
})

const commandOutputChunkSchema = z.object({
  type: z.literal('command_chunk'),
  data: z.object({
    content: z.string(),
    done: z.boolean(),
  }),
})

const commandCompleteSchema = z.object({
  type: z.literal('command_complete'),
  data: z.object({
    exitCode: z.number(),
  }),
})

export const runTool = tool(
  async (input: z.infer<typeof commandInputSchema>) => {
    try {
      const { command, timeout, cwd, env } = input

      // Create async generator for stream messages
      async function* generateMessages(): AsyncGenerator<StreamMessage> {
        yield {
          type: 'run',
          data: {
            command,
            timeout,
            cwd,
            env,
          },
        }
      }

      // Get response stream
      const response = await createStreamResponse(generateMessages())

      if (!response.ok || !response.body) {
        throw new Error('Failed to execute command')
      }

      const reader = response.body.getReader()
      let output = ''
      let exitCode: number | undefined

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const decoder = new TextDecoder()
          const chunk = decoder.decode(value)
          const messages = chunk.split('\n\n')

          for (const message of messages) {
            if (!message.startsWith('data: ')) continue

            try {
              const decoded = decodeAndDecompressMessage(message.slice(6))
              if ('content' in decoded && decoded.content) {
                const parsedContent = JSON.parse(decoded.content)

                if (commandOutputChunkSchema.safeParse(parsedContent).success) {
                  output += parsedContent.data.content
                }
              } else if (decoded.type === 'complete' && decoded.responses) {
                const completeResponse = decoded.responses[0]
                if (commandCompleteSchema.safeParse(completeResponse).success) {
                  exitCode = completeResponse.data.exitCode
                }
              }
            } catch (error) {
              logger.error('Failed to parse command response:', error)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (typeof exitCode !== 'number') {
        throw new Error('Stream ended without completion')
      }

      return JSON.stringify({
        output,
        exitCode,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error }, 'Run tool error')
      throw new Error(`Failed to execute command: ${message}`)
    }
  },
  {
    name: 'run',
    description: 'Run a shell command in the client workspace',
    schema: commandInputSchema,
  }
)
