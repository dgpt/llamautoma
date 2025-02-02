import 'ses'
import { z } from 'zod'
import { BaseReActTool } from './baseTool'

/**
 * Tool for securely executing TypeScript code using SES (Secure ECMAScript)
 */
export class TypeScriptExecutionTool extends BaseReActTool {
  name = 'typescript_exec'
  description = 'Securely execute TypeScript code in an isolated environment'
  private logs: [string, ...any[]][] = []

  constructor() {
    super()
    // Lockdown the environment to prevent access to dangerous APIs
    globalThis.lockdown({
      errorTaming: 'unsafe',
      overrideTaming: 'severe',
    })
  }

  public transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      const schema = z.object({
        code: z.string(),
        config: z.object({
          hideMessage: z.boolean().optional().default(false),
          timeout: z.number().optional().default(5000), // Default 5 second timeout
        }).optional().default({})
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
    const { code, config } = JSON.parse(input)

    try {
      // Create a secure compartment for code execution
      const compartment = new Compartment({
        // Provide minimal safe globals
        console: {
          log: (...args: any[]) => this.logs.push(['log', ...args]),
          error: (...args: any[]) => this.logs.push(['error', ...args]),
          warn: (...args: any[]) => this.logs.push(['warn', ...args]),
        },
        // Add other safe built-ins as needed
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        RegExp,
      })

      // Execute the code with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Execution timed out')), config.timeout)
      })

      const executionPromise = new Promise((resolve) => {
        // Evaluate the code in the secure compartment
        const result = compartment.evaluate(code)
        resolve(result)
      })

      const result = await Promise.race([executionPromise, timeoutPromise])

      // Format the response
      const response = {
        result: String(result),
        success: true,
        hideMessage: config.hideMessage
      }

      return JSON.stringify(response)
    } catch (error) {
      const response = {
        result: null,
        logs: this.logs,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        hideMessage: false
      }
      return JSON.stringify(response)
    }
  }
}