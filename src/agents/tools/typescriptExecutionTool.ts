import { Tool } from '@langchain/core/tools'
import { logger } from '@/utils/logger'

interface TypeScriptExecutionConfig {
  maxIterations?: number
  maxOutputLength?: number
}

interface ExecutionContext {
  console: {
    log: (...args: any[]) => void
    error: (...args: any[]) => void
    warn: (...args: any[]) => void
    info: (...args: any[]) => void
  }
  output: string[]
  iterations: number
}

export class TypeScriptExecutionTool extends Tool {
  name = 'typescript-execution'
  description = 'Execute TypeScript code and return the result'
  private config: TypeScriptExecutionConfig
  private currentContext: ExecutionContext | null = null

  constructor(config: TypeScriptExecutionConfig = {}) {
    super()
    this.config = {
      maxIterations: config.maxIterations || 1000,
      maxOutputLength: config.maxOutputLength || 1000
    }
  }

  async _call(input: string): Promise<string> {
    try {
      logger.debug('Executing TypeScript code')
      const result = await this.executeCode(input)
      return result
    } catch (error) {
      logger.error({ error }, 'TypeScript execution failed')
      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  private async executeCode(code: string): Promise<string> {
    try {
      // Create a safe execution environment
      this.currentContext = {
        console: {
          log: (...args: any[]) => this.captureOutput(args),
          error: (...args: any[]) => this.captureOutput(args, 'error'),
          warn: (...args: any[]) => this.captureOutput(args, 'warn'),
          info: (...args: any[]) => this.captureOutput(args, 'info')
        },
        output: [],
        iterations: 0
      }

      // Execute code in context
      const result = await this.runInContext(code, this.currentContext)
      return this.currentContext.output.join('\n') || String(result)
    } catch (error) {
      throw error
    } finally {
      this.currentContext = null
    }
  }

  private async runInContext(code: string, context: ExecutionContext): Promise<any> {
    const wrappedCode = `
      with (context) {
        ${code}
      }
    `

    try {
      const fn = new Function('context', wrappedCode)
      return fn(context)
    } catch (error) {
      throw new Error(`Code execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private captureOutput(args: any[], level: 'log' | 'error' | 'warn' | 'info' = 'log'): void {
    if (!this.currentContext) {
      throw new Error('No active execution context')
    }

    const output = args.map(arg => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }).join(' ')

    if (output.length > this.config.maxOutputLength!) {
      throw new Error('Output exceeds maximum length')
    }

    this.currentContext.output.push(`[${level}] ${output}`)
  }
}