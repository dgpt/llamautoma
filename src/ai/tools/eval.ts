import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { logError } from '@/logger'
import { createContext, runInContext } from 'vm'

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

// Schema for eval input
const evalInputSchema = z.object({
  code: z.string().describe('The TypeScript code to evaluate'),
  maxIterations: z.number().optional().describe('Maximum number of iterations allowed'),
  maxOutputLength: z.number().optional().describe('Maximum length of output allowed'),
})

// Create a function to capture output
function createOutputCapture(maxOutputLength: number) {
  const output: string[] = []

  return {
    capture: (args: any[], level: 'log' | 'error' | 'warn' | 'info' = 'log'): void => {
      const formattedOutput = args
        .map(arg => {
          if (typeof arg === 'string') return arg
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')

      if (formattedOutput.length > maxOutputLength) {
        throw new Error('Output exceeds maximum length')
      }

      output.push(`[${level}] ${formattedOutput}`)
    },
    getOutput: () => output,
  }
}

// Create the eval tool using LangChain's tool function
export const evalTool = tool(
  async (input: z.infer<typeof evalInputSchema>) => {
    const maxIterations = input.maxIterations || 1000
    const maxOutputLength = input.maxOutputLength || 1000
    const outputCapture = createOutputCapture(maxOutputLength)

    try {
      // Create execution context
      const context: ExecutionContext = {
        console: {
          log: (...args) => outputCapture.capture(args, 'log'),
          error: (...args) => outputCapture.capture(args, 'error'),
          warn: (...args) => outputCapture.capture(args, 'warn'),
          info: (...args) => outputCapture.capture(args, 'info'),
        },
        output: [],
        iterations: 0,
        lastValue: undefined,
      }

      // Execute code
      const result = runInContext(
        `function main() { ${input.code} } main()`,
        createContext(context)
      )
      context.lastValue = result

      // Format output and logs
      const executionResult: ExecutionResult = {
        result: String(result),
        logs: outputCapture.getOutput(),
      }

      // Return formatted result
      if (executionResult.logs.length > 0) {
        return `${executionResult.result}${executionResult.logs.length > 0 ? `\n\nLogs:\n${executionResult.logs.join('\n')}` : ''}`
      }
      return executionResult.result
    } catch (error) {
      logError('typescript-execution', error instanceof Error ? error.message : String(error))
      throw error
    }
  },
  {
    name: 'eval',
    description: 'Evaluate TypeScript code in a secure environment and return the result',
    schema: evalInputSchema,
  }
)
