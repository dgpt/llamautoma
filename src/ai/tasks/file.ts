import { task } from '@langchain/langgraph'
import { z } from 'zod'
import { streamToClient, waitForClientResponse } from '../utils/stream'
import { logger } from '@/logger'

// Schema for file request types
const FileRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('files'),
    paths: z.array(z.string()),
  }),
  z.object({
    type: z.literal('directory'),
    path: z.string(),
    includePattern: z.string().optional(),
    excludePattern: z.string().optional(),
  }),
  z.object({
    type: z.literal('directories'),
    paths: z.array(z.string()),
    includePattern: z.string().optional(),
    excludePattern: z.string().optional(),
  }),
])

// Schema for file chunk response
const FileChunkSchema = z.object({
  type: z.literal('file_chunk'),
  data: z.object({
    path: z.string(),
    chunk: z.string(),
    done: z.boolean(),
    error: z.string().optional(),
  }),
})

// Schema for completion response
const FileCompleteSchema = z.object({
  type: z.literal('file_complete'),
})

// Schema for error response
const ErrorResponseSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
})

// Combined response schema
const ResponseSchema = z.discriminatedUnion('type', [
  FileChunkSchema,
  FileCompleteSchema,
  ErrorResponseSchema,
])

export type FileRequest = z.infer<typeof FileRequestSchema>
export type FileResponse = {
  [path: string]: {
    content: string
    error?: string
  }
}

// Create the file task
export const fileTask = task('file', async (request: FileRequest): Promise<FileResponse> => {
  // Format request for client
  const clientRequest = {
    type: 'file_request',
    data: {
      requestType: request.type,
      paths: 'path' in request ? [request.path] : request.paths,
      includePattern: 'includePattern' in request ? request.includePattern : undefined,
      excludePattern: 'excludePattern' in request ? request.excludePattern : undefined,
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
        const { path, chunk, done, error } = result.data.data

        // Initialize file entry if needed
        if (!files[path]) {
          files[path] = { content: '' }
        }

        // Handle error
        if (error) {
          files[path].error = error
          continue
        }

        // Append chunk
        files[path].content += chunk
        break

      case 'file_complete':
        // All files received
        return files

      case 'error':
        logger.error({ error: result.data.error }, 'Error from client')
        throw new Error(result.data.error)
    }
  }
})
