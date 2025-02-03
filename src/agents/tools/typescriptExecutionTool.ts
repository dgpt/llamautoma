import { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '@/logger'
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

interface ErrorDetails {
  name?: string
  message?: string
  stack?: string
  error?: unknown
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
      logger.debug('Executing TypeScript code', { input })
      const result = await this.executeCode(input.code)
      logger.debug('Execution complete', { result })
      return result
    } catch (error) {
      const errorDetails: ErrorDetails =
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : { error }

      logger.error('TypeScript execution failed', { errorDetails })
      throw error
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
          info: (...args: any[]) => this.captureOutput(args, 'info'),
        },
        output: [],
        iterations: 0,
        lastValue: undefined,
      }

      // Create a secure VM context
      const vmContext = createContext({
        console: this.currentContext.console,
      })

      // Execute code in secure context
      this.currentContext.lastValue = runInContext(code, vmContext, {
        timeout: 1000, // 1 second timeout
        displayErrors: true,
      })

      const output = this.currentContext.output.join('\n')
      const result = this.currentContext.lastValue
      return output ? `${output}\n${result}` : String(result)
    } catch (error) {
      const errorDetails: ErrorDetails =
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : { error }

      logger.error('Code execution failed', { errorDetails, code })
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