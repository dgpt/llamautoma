import { task } from '@langchain/langgraph'
import { SafetyConfig, SafetyCheckResult } from '../../../types/agent'
import { logger } from '../../../utils/logger'

// Constants
const DEFAULT_MAX_INPUT_LENGTH = 10000
const DEFAULT_DANGEROUS_PATTERNS = [
  'drop',
  'truncate',
  'exec',
  'curl',
  'wget',
  'bash -c',
  'rm -rf /',
  'zsh -c',
  'sh -c',
]

// Check input length
const checkInputLength = task(
  'check_input_length',
  async (input: string, maxLength: number): Promise<SafetyCheckResult> => {
    try {
      if (!input) {
        return { passed: false, reason: 'Input is empty' }
      }
      if (input.length > maxLength) {
        return { passed: false, reason: `Input length (${input.length}) exceeds maximum length (${maxLength})` }
      }
      return { passed: true }
    } catch (error) {
      logger.error({ error }, 'Input length check failed')
      return {
        passed: false,
        reason: `Input length check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      const foundPatterns = patterns.filter((pattern) => combinedInput.includes(pattern.toLowerCase()))

      if (foundPatterns.length > 0) {
        return {
          passed: false,
          reason: `Input contains dangerous patterns: ${foundPatterns.join(', ')}`,
        }
      }
      return { passed: true }
    } catch (error) {
      logger.error({ error }, 'Dangerous pattern check failed')
      return {
        passed: false,
        reason: `Pattern check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }
)

// Run custom safety checks
const runCustomChecks = task(
  'run_custom_checks',
  async (toolName: string, input: string, config: SafetyConfig): Promise<SafetyCheckResult> => {
    try {
      return { passed: true }
    } catch (error) {
      logger.error({ error }, 'Error running custom safety checks')
      return {
        passed: false,
        reason: 'Safety check system error',
      }
    }
  }
)

// Main safety checker
export const SafetyChecker = {
  async runSafetyChecks(toolName: string, input: string, config: SafetyConfig): Promise<SafetyCheckResult> {
    try {
      // Validate inputs
      if (!toolName) {
        return { passed: false, reason: 'Tool name is required' }
      }

      if (input === undefined || input === null) {
        return { passed: false, reason: 'Input is required' }
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

      // Check input length
      const maxLength = config.maxInputLength
      const lengthResult = await checkInputLength(
        typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput),
        maxLength
      )
      if (!lengthResult.passed) {
        return lengthResult
      }

      // Check dangerous patterns
      const dangerousPatterns = config.dangerousToolPatterns
      const patternResult = await checkDangerousPatterns(
        toolName,
        typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput),
        dangerousPatterns
      )
      if (!patternResult.passed) {
        return patternResult
      }

      // Run custom checks
      const customResult = await runCustomChecks(
        toolName,
        typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput),
        config
      )
      if (!customResult.passed) {
        return customResult
      }

      return { passed: true }
    } catch (error) {
      logger.error({ error, toolName }, 'Safety check failed')
      return {
        passed: false,
        reason: `Safety check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }
}
