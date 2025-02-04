import { z } from 'zod'
import { logError } from '@/logger'
import { createContext, runInContext } from 'vm'
import { StructuredTool } from '@langchain/core/tools'

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
  lastValue: any
}

interface ExecutionResult {
  result: string
  logs: string[]
}

export class TypeScriptExecutionTool extends StructuredTool {
  name = 'typescript-execution'
  description = 'Execute TypeScript code in a secure environment and return the result'
  schema = z.object({
    code: z.string().describe('The TypeScript code to execute'),
  })

  private config: TypeScriptExecutionConfig
  private currentContext: ExecutionContext | null = null

  constructor(config: TypeScriptExecutionConfig = {}) {
    super()
    this.config = {
      maxIterations: config.maxIterations || 1000,
      maxOutputLength: config.maxOutputLength || 1000,
    }
  }

  async _call(input: { code: string }): Promise<string> {
    try {
      // Create execution context
      this.currentContext = {
        console: {
          log: (...args) => this.captureOutput(args, 'log'),
          error: (...args) => this.captureOutput(args, 'error'),
          warn: (...args) => this.captureOutput(args, 'warn'),
          info: (...args) => this.captureOutput(args, 'info'),
        },
        output: [],
        iterations: 0,
        lastValue: undefined,
      }

      // Execute code
      const result = runInContext(
        `function main() { ${input.code} } main()`,
        createContext(this.currentContext)
      )
      this.currentContext.lastValue = result

      // Format output and logs
      const executionResult: ExecutionResult = {
        result: String(result),
        logs: this.currentContext.output,
      }

      // Return formatted result
      if (executionResult.logs.length > 0) {
        return `${executionResult.result}${executionResult.logs.length > 0 ? `\n\nLogs:\n${executionResult.logs.join('\n')}` : ''}`
      }
      return executionResult.result
    } catch (error) {
      logError('typescript-execution', error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      this.currentContext = null
    }
  }

  private captureOutput(args: any[], level: 'log' | 'error' | 'warn' | 'info' = 'log'): void {
    if (!this.currentContext) {
      throw new Error('No active execution context')
    }

    const output = args
      .map(arg => {
        if (typeof arg === 'string') return arg
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(' ')

    if (output.length > this.config.maxOutputLength!) {
      throw new Error('Output exceeds maximum length')
    }

    this.currentContext.output.push(`[${level}] ${output}`)
  }
}
