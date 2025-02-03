import { task } from '@langchain/langgraph'
import { SafetyConfig, SafetyCheckResult } from '@/types/agent'
import { logger } from '@/logger'

// Constants
// Check input length
const checkInputLength = task(
  'check_input_length',
  async (input: string, maxLength: number): Promise<SafetyCheckResult> => {
    try {
      if (!input) {
        return { passed: false, reason: 'Input is empty' }
      }
      if (input.length > maxLength) {
        return {
          passed: false,
          reason: `Input length (${input.length}) exceeds maximum length (${maxLength})`,
          warnings: [`Input length (${input.length}) exceeds maximum length (${maxLength})`],
        }
      }
      return { passed: true }
    } catch (error) {
      logger.error({ error }, 'Input length check failed')
      return {
        passed: false,
        reason: `Input length check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        warnings: [
          `Input length check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      }
    }
  }
)

// Check for dangerous patterns
const checkDangerousPatterns = task(
  'check_dangerous_patterns',
  async (toolName: string, input: string, patterns: string[]): Promise<SafetyCheckResult> => {
    try {
      const combinedInput = `${toolName} ${input}`.toLowerCase()
      const foundPatterns = patterns.filter(pattern =>
        combinedInput.includes(pattern.toLowerCase())
      )

      if (foundPatterns.length > 0) {
        const warnings = foundPatterns.map(pattern => `Dangerous pattern detected: ${pattern}`)
        return {
          passed: false,
          reason: `Input contains dangerous patterns: ${foundPatterns.join(', ')}`,
          warnings,
        }
      }
      return { passed: true }
    } catch (error) {
      logger.error({ error }, 'Dangerous pattern check failed')
      return {
        passed: false,
        reason: `Pattern check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        warnings: [
          `Pattern check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      }
    }
  }
)

// Main safety checker
export const SafetyChecker = {
  async runSafetyChecks(
    toolName: string,
    input: string,
    config: SafetyConfig
  ): Promise<SafetyCheckResult> {
    try {
      // Validate inputs
      if (!toolName) {
        return {
          passed: false,
          reason: 'Tool name is required',
          warnings: ['Tool name is required'],
        }
      }

      if (input === undefined || input === null) {
        return { passed: false, reason: 'Input is required', warnings: ['Input is required'] }
      }

      // Parse input if it's a JSON string
      let parsedInput = input
      if (typeof input === 'string' && input.trim().startsWith('{')) {
        try {
          parsedInput = JSON.parse(input)
        } catch (parseError) {
          logger.warn({ error: parseError }, 'Failed to parse input as JSON, using raw string')
        }
      }

      const warnings: string[] = []

      // Check input length
      const maxLength = config.maxInputLength
      const lengthResult = await checkInputLength(
        typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput),
        maxLength
      )
      if (!lengthResult.passed) {
        warnings.push(...(lengthResult.warnings || []))
      }

      // Check dangerous patterns
      const dangerousPatterns = config.dangerousToolPatterns
      const patternResult = await checkDangerousPatterns(
        toolName,
        typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput),
        dangerousPatterns
      )
      if (!patternResult.passed) {
        warnings.push(...(patternResult.warnings || []))
      }

      // If any checks failed, return failure with all warnings
      if (!lengthResult.passed || !patternResult.passed) {
        return {
          passed: false,
          reason: 'Safety checks failed',
          warnings,
        }
      }

      return { passed: true }
    } catch (error) {
      logger.error({ error, toolName }, 'Safety check failed')
      return {
        passed: false,
        reason: `Safety check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        warnings: [
          `Safety check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      }
    }
  },
}
