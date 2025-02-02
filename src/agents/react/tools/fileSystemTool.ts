import { z } from 'zod'
import { BaseReActTool } from './baseTool'

/**
 * Tool for interacting with the file system
 */
export class FileSystemTool extends BaseReActTool {
  name = 'filesystem'
  description = 'Tool for reading, writing, and manipulating files and directories'

  public transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      const schema = z.object({
        operation: z.enum(['read', 'write', 'delete', 'list', 'exists']),
        path: z.string(),
        content: z.string().optional()
      })

      const result = schema.safeParse(parsed)
      if (!result.success) {
        return undefined
      }

      return JSON.stringify(result.data)
    } catch {
      return undefined
    }
  }

  protected async execute(input: string): Promise<string> {
    const { operation, path, content } = JSON.parse(input)

    // This is just a stub - actual implementation will be handled by the client
    const response: {
      success: boolean
      operation: string
      path: string
      content?: string
      requiresConfirmation: boolean
      error?: string
    } = {
      success: false,
      operation,
      path,
      content,
      requiresConfirmation: true,
      error: 'Operation not implemented by client'
    }

    // For exists operation, we can return a default response
    if (operation === 'exists') {
      response.success = true
      delete response.error
      response.requiresConfirmation = false
    }

    return JSON.stringify(response)
  }
}