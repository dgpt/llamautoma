export const DEFAULT_AGENT_CONFIG = {
  modelName: 'qwen2.5-coder:1.5b',
  host: 'http://localhost:8000',
  maxIterations: 10,
  userInputTimeout: 30000,
  safetyConfig: {
    maxInputLength: 4096,
  },
}
