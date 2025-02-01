import { z } from 'zod'
import { BaseReActTool } from './baseTool'
import { FileSystemSync } from '../../../utils/fs'

export class FileSystemTool extends BaseReActTool {
  name = 'fileSystem'
  description = 'Tool for interacting with the file system'
  fs: FileSystemSync

  constructor() {
    super()
    this.fs = new FileSystemSync()
  }

  protected transformInput(input: string): string | undefined {
    try {
      const schema = z.object({
        action: z.enum(['readFile', 'writeFile', 'listFiles', 'deleteFile']),
        path: z.string(),
        content: z.string().optional(),
      })

      const result = schema.safeParse(JSON.parse(input))
      if (!result.success) {
        return undefined
      }

      return JSON.stringify(result.data)
    } catch {
      return undefined
    }
  }

  protected async execute(input: string): Promise<string> {
    const args = JSON.parse(input)
    switch (args.action) {
      case 'readFile':
        return await this.fs.readFile(args.path)
      case 'writeFile':
        if (!args.content) {
          throw new Error('Content is required for writeFile')
        }
        await this.fs.writeFile(args.path, args.content)
        return `File ${args.path} written successfully`
      case 'listFiles':
        const files = await this.fs.listFiles(args.path)
        return JSON.stringify(files)
      case 'deleteFile':
        await this.fs.deleteFile(args.path)
        return `File ${args.path} deleted successfully`
      default:
        throw new Error(`Unknown action: ${args.action}`)
    }
  }
}
