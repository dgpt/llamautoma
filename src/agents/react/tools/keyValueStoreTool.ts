import { z } from 'zod'
import { BaseReActTool } from './baseTool'

export class KeyValueStoreTool extends BaseReActTool {
  name = 'store'
  description = 'Store and retrieve key-value pairs'
  requiresReview = false
  private store: Map<string, string> = new Map()

  public transformInput(input: string): string | undefined {
    try {
      const parsed = z
        .object({
          operation: z.enum(['get', 'set', 'delete']),
          key: z.string(),
          value: z.string().optional(),
        })
        .parse(JSON.parse(input))
      return JSON.stringify(parsed)
    } catch {
      return undefined
    }
  }

  protected async execute(input: string): Promise<string> {
    const args = JSON.parse(input)
    switch (args.operation) {
      case 'get':
        const value = this.store.get(args.key)
        if (!value) throw new Error(`Key not found: ${args.key}`)
        return value
      case 'set':
        if (!args.value) throw new Error('Value required for set operation')
        this.store.set(args.key, args.value)
        return 'Value stored successfully'
      case 'delete':
        if (!this.store.has(args.key)) throw new Error(`Key not found: ${args.key}`)
        this.store.delete(args.key)
        return 'Value deleted successfully'
      default:
        throw new Error(`Invalid operation: ${args.operation}`)
    }
  }
}
