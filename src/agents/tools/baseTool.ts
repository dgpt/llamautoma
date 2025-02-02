import { Tool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * Base tool class with JSON validation
 */
export abstract class BaseTool extends Tool {
  abstract name: string
  abstract description: string

  protected schema = z
    .object({
      input: z.string().optional(),
    })
    .transform((val) => val.input)

  constructor() {
    super({
      name: '',
      description: '',
      schema: z
        .object({
          input: z.string().optional(),
        })
        .transform((val) => val.input),
    })
  }

  abstract _call(args: Record<string, any>): Promise<any>
}

/**
 * Base tool class with JSON validation
 */
export abstract class BaseReActTool extends Tool {
  abstract name: string
  abstract description: string

  public schema = z
    .object({
      input: z.string().optional(),
    })
    .transform((obj) => {
      if (!obj.input) return undefined
      return this.transformInput(obj.input)
    })

  protected transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      return JSON.stringify(parsed)
    } catch {
      return undefined
    }
  }

  protected abstract execute(input: string): Promise<string>

  async _call(input: string): Promise<string> {
    const transformed = this.transformInput(input)
    if (!transformed) {
      throw new Error('Invalid input format')
    }
    return this.execute(transformed)
  }
}

/**
 * Wraps a standard Tool to add JSON validation
 */
export class WrappedReActTool extends Tool {
  private wrappedTool: Tool
  public name: string
  public description: string

  constructor(tool: Tool) {
    super()
    this.wrappedTool = tool
    this.name = tool.name
    this.description = tool.description
  }

  protected transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      return JSON.stringify(parsed)
    } catch {
      return undefined
    }
  }

  async _call(input: string): Promise<string> {
    const transformed = this.transformInput(input)
    if (!transformed) {
      throw new Error('Invalid input format')
    }
    return this.wrappedTool.call(input)
  }
}

/**
 * Converts a standard Tool to a BaseReActTool
 */
export function convertToBaseReActTool(tool: Tool): Tool {
  return new WrappedReActTool(tool)
}
