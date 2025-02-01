import { z } from 'zod'
import { BaseReActTool } from './baseTool'

export class TextProcessingTool extends BaseReActTool {
  name = 'text'
  description = 'Process text with various operations'
  requiresReview = false

  public transformInput(input: string): string | undefined {
    try {
      const parsed = z
        .object({
          operation: z.enum(['uppercase', 'lowercase', 'reverse', 'length']),
          text: z.string(),
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
      case 'uppercase':
        return args.text.toUpperCase()
      case 'lowercase':
        return args.text.toLowerCase()
      case 'reverse':
        return args.text.split('').reverse().join('')
      case 'length':
        return args.text.length.toString()
      default:
        throw new Error(`Invalid operation: ${args.operation}`)
    }
  }
}
