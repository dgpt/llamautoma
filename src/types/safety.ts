export interface SafetyConfig {
  requireToolConfirmation?: boolean
  requireToolFeedback?: boolean
  maxInputLength?: number
  dangerousToolPatterns?: string[]
}

export interface SafetyCheckResult {
  passed: boolean
  reason?: string
}

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: Error
  safetyResult?: SafetyCheckResult
}