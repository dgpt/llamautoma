import { z } from 'zod'
import {
  BaseConfigSchema,
  MemoryConfigSchema,
  SafetyConfigSchema,
  ToolConfigSchema,
  DEFAULT_CONFIG as BASE_DEFAULT_CONFIG,
} from 'llamautoma-types'

// Schema for model configuration per task type
export const TaskModelsConfigSchema = z.object({
  coder: z.string().default('qwen2.5-coder:32b'),
  intent: z.string().default('llama3.2'),
  planner: z.string().default('llama3.2'),
  reviewer: z.string().default('qwen2.5-coder:32b'),
  summarizer: z.string().default('llama3.2'),
})

// Schema for server configuration
export const ServerConfigSchema = z.object({
  host: z.string().default('http://localhost:11434'),
  port: z.number().default(3000),
})

// Complete configuration schema
export const ConfigSchema = BaseConfigSchema.extend({
  models: TaskModelsConfigSchema,
  server: ServerConfigSchema,
  memory: MemoryConfigSchema,
  safety: SafetyConfigSchema,
  tools: ToolConfigSchema,
})

// Default configuration for production
// DO NOT USE THIS OUTSIDE OF src/index.ts or src/ai/llm.ts
// Instead, we should use the config passed down from src/index.ts.
export const DEFAULT_CONFIG = {
  ...BASE_DEFAULT_CONFIG,
  name: 'llamautoma',
  description: 'AI agent for code generation and management',
  models: {
    coder: 'qwen2.5-coder:32b',
    intent: 'llama3.2',
    planner: 'llama3.2',
    reviewer: 'qwen2.5-coder:32b',
    summarizer: 'llama3.2',
  },
  server: {
    host: 'http://localhost:11434',
    port: 3000,
  },
}

// Test configuration
// DO NOT USE THIS OUTSIDE OF tests/
export const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  models: {
    coder: 'qwen2.5-coder:7b',
    intent: 'llama3.2',
    planner: 'llama3.2',
    reviewer: 'qwen2.5-coder:1.5b',
    summarizer: 'llama3.2',
  },
}

// Export types
export type TaskModelsConfig = z.infer<typeof TaskModelsConfigSchema>
export type ServerConfig = z.infer<typeof ServerConfigSchema>
export type Config = z.infer<typeof ConfigSchema>

// Re-export types from llamautoma-types
export type { BaseConfig, MemoryConfig, SafetyConfig, ToolConfig } from 'llamautoma-types'
