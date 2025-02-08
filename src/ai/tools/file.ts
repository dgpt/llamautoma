import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { getFile } from '@/lib/file'
import { logger } from '@/logger'

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

// Create the file tool using LangChain's tool function
export const fileTool = tool(
  async (input: z.infer<typeof FileInputSchema>) => {
    try {
      if (input.paths.length === 0) {
        throw new Error('No paths provided')
      }

      // Process each path
      const results: Record<string, { path: string; content?: string; error?: string }> = {}

      for (const path of input.paths) {
        try {
          // Request file content from client
          const content = await getFile(path)
          results[path] = { path, content }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results[path] = { path, error: message }
        }
      }

      // Return files as JSON string for LLM consumption
      return JSON.stringify(results, null, 2)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error }, 'File tool error')
      throw new Error(`Failed to read files: ${message}`)
    }
  },
  {
    name: 'file',
    description: 'Read files and directories from the client',
    schema: FileInputSchema,
  }
)
