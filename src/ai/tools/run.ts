import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import { streamToClient, waitForClientResponse } from '../utils/stream'
import { logger } from '@/logger'

// Schema for run command input
const runInputSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
})

// Schema for command output chunk
const CommandChunkSchema = z.object({
  type: z.literal('command_chunk'),
  data: z.object({
    content: z.string(),
    done: z.boolean(),
    error: z.string().optional(),
  }),
})

// Schema for completion response
const CommandCompleteSchema = z.object({
  type: z.literal('command_complete'),
  data: z.object({
    exitCode: z.number(),
    signal: z.string().optional(),
  }),
})

// Schema for error response
const ErrorResponseSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
})

// Combined response schema
const ResponseSchema = z.discriminatedUnion('type', [
  CommandChunkSchema,
  CommandCompleteSchema,
  ErrorResponseSchema,
])

export type CommandResponse = {
  output: string
  exitCode: number
  signal?: string
  error?: string
}

export class RunTool extends StructuredTool {
  name = 'run'
  description = 'Execute shell commands in the client workspace'
  schema = runInputSchema

  async _call(input: z.infer<typeof runInputSchema>): Promise<string> {
    try {
      // Format request for client
      const clientRequest = {
        type: 'command_request',
        data: {
          command: input.command,
          cwd: input.cwd,
          env: input.env,
          timeout: input.timeout,
        },
      }

      // Stream request to client
      await streamToClient(clientRequest)

      // Collect command output
      const response: CommandResponse = {
        output: '',
        exitCode: 0,
      }

      while (true) {
        const chunk = await waitForClientResponse<z.infer<typeof ResponseSchema>>()
        if (!chunk) {
          logger.error('No response received from client')
          throw new Error('No response received from client')
        }

        // Validate response
        const result = ResponseSchema.safeParse(chunk)
        if (!result.success) {
          logger.error({ error: result.error }, 'Invalid response from client')
          throw new Error('Invalid response from client')
        }

        switch (result.data.type) {
          case 'command_chunk':
            const { content, error } = result.data.data

            // Handle error
            if (error) {
              response.error = error
              continue
            }

            // Append output
            response.output += content
            break

          case 'command_complete':
            // Command finished
            response.exitCode = result.data.data.exitCode
            response.signal = result.data.data.signal
            return JSON.stringify(response, null, 2)

          case 'error':
            logger.error({ error: result.data.error }, 'Error from client')
            throw new Error(result.data.error)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error }, 'Run tool error')
      throw new Error(`Failed to execute command: ${message}`)
    }
  }
}
