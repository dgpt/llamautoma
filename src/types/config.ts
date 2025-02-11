/**
 * Configuration options for the LLM
 */
export interface LLMConfig {
  temperature?: number
  topP?: number
  topK?: number
  numPredict?: number
  repeatPenalty?: number
  repeatLastN?: number
  contextWindow?: number
  stopSequences?: string[]
}

/**
 * Main configuration interface for Llamautoma
 */
export interface Config {
  name: string
  description: string
  models: {
    coder: string
    intent: string
    planner: string
    reviewer: string
    summarizer: string
  }
  server: {
    host: string
    port: number
  }
  llm?: LLMConfig
  maxIterations?: number
  timeout?: number
}
