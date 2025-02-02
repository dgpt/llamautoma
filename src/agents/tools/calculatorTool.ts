import { z } from 'zod'
import { BaseReActTool } from './baseTool'

export class CalculatorTool extends BaseReActTool {
  name = 'calculator'
  description = 'Perform basic arithmetic operations (add, subtract, multiply, divide)'
  requiresReview = false

  public transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      const schema = z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.coerce.number(),
        b: z.coerce.number(),
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
    const args = JSON.parse(input)
    switch (args.operation) {
      case 'add':
        return `${args.a + args.b}`
      case 'subtract':
        return `${args.a - args.b}`
      case 'multiply':
        return `${args.a * args.b}`
      case 'divide':
        if (args.b === 0) throw new Error('Division by zero')
        return `${args.a / args.b}`
      default:
        throw new Error(`Invalid operation: ${args.operation}`)
    }
  }
}
