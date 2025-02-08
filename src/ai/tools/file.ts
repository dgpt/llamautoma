import { z } from 'zod'
import { tool, type ToolRunnableConfig } from '@langchain/core/tools'
import { getFile, getDirectory } from '@/lib/file'
import { logger } from '@/logger'
import { DEFAULT_AGENT_CONFIG } from '@/types'

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
  async (
    input: z.infer<typeof FileInputSchema>,
    options?: ToolRunnableConfig<Record<string, any>>
  ) => {
    try {
      if (input.paths.length === 0) {
        throw new Error('No paths provided')
      }

      // Process each path
      const results: Record<string, { path: string; content?: string; error?: string }> = {}

      // Merge tool config with default config
      const config = {
        ...DEFAULT_AGENT_CONFIG,
        ...(options?.configurable || {}),
      }

      for (const path of input.paths) {
        try {
          switch (input.requestType) {
            case 'file':
            case 'files': {
              // Request file content from client
              const content = await getFile(path, config)
              results[path] = { path, content }
              break
            }
            case 'directory':
            case 'directories': {
              // Request directory contents from client
              const files = await getDirectory(
                path,
                config,
                input.includePattern,
                input.excludePattern
              )
              // Get first file's content as the representative content
              const firstFile = Object.entries(files)[0]
              if (firstFile) {
                results[path] = { path, content: firstFile[1] }
              } else {
                results[path] = { path, error: 'No matching files found' }
              }
              break
            }
          }
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
