import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { streamToClient, waitForClientResponse } from '../utils/stream'
import { logger } from '@/logger'
import { FileOp } from 'llamautoma-types'
import { decodeFile } from '../lib/compression'

// Schema for file request types
const FileInputSchema = z.object({
  requestType: z
    .enum(['file', 'files', 'directory', 'directories'])
    .describe(
      'Do we need to look up a file, multiple files, a directory, or multiple directories?'
    ),
  paths: z.array(z.string()).describe('The paths to the files or directories we need to look up'),
  includePattern: z.string().optional().describe('A pattern to include in the search'),
  excludePattern: z.string().optional().describe('A pattern to exclude from the search'),
})

// Schema for file chunk response
const FileChunkResponseSchema = z.object({
  type: z.literal('file_chunk'),
  data: z.object({
    path: z.string(),
    chunk: z.string(),
    done: z.boolean(),
    error: z.string().optional(),
  }),
})

// Schema for completion response
const FileCompleteResponseSchema = z.object({
  type: z.literal('file_complete'),
})

// Schema for error response
const ErrorResponseSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
})

// Combined response schema
const ResponseSchema = z.discriminatedUnion('type', [
  FileChunkResponseSchema,
  FileCompleteResponseSchema,
  ErrorResponseSchema,
])

export type FileResponse = {
  [path: string]: FileOp
}

// Create the file tool using LangChain's tool function
export const fileTool = tool(
  async (input: z.infer<typeof FileInputSchema>) => {
    try {
      // Format request for client
      const clientRequest = {
        type: 'file_request',
        data: {
          requestType: input.requestType,
          paths: input.paths,
          includePattern: input.includePattern,
          excludePattern: input.excludePattern,
        },
      }

      // Stream request to client
      await streamToClient(clientRequest)

      // Collect file chunks
      const files: FileResponse = {}

      while (true) {
        const response = await waitForClientResponse<z.infer<typeof ResponseSchema>>()
        if (!response) {
          logger.error('No response received from client')
          throw new Error('No response received from client')
        }

        // Validate response
        const result = ResponseSchema.safeParse(response)
        if (!result.success) {
          logger.error({ error: result.error }, 'Invalid response from client')
          throw new Error('Invalid response from client')
        }

        switch (result.data.type) {
          case 'file_chunk':
            const { path, chunk, error } = result.data.data

            // Initialize file entry if needed
            if (!files[path]) {
              files[path] = { path, content: '' }
            }

            // Handle error
            if (error) {
              files[path].error = error
              continue
            }

            // Handle compressed chunk
            if (chunk.startsWith('brotli:')) {
              const decompressed = await decodeFile(chunk.slice(7))
              files[path].content += decompressed
            } else {
              // Handle uncompressed chunk for backward compatibility
              files[path].content += chunk
            }
            break

          case 'file_complete':
            // All files received
            return JSON.stringify(files, null, 2)

          case 'error':
            logger.error({ error: result.data.error }, 'Error from client')
            throw new Error(result.data.error)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error }, 'File tool error')
      throw new Error(`Failed to read files: ${message}`)
    }
  },
  {
    name: 'file',
    description: 'Read files and directories from the workspace',
    schema: FileInputSchema,
  }
)
