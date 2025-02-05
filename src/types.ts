import { z } from 'zod'
import { RunnableConfig as LangChainRunnableConfig } from '@langchain/core/runnables'
import {
  Message,
  Messages,
  Safety as SafetyCheck,
  ToolType,
  Param as ToolParam,
  Tool,
  Call as ToolCall,
  ToolResult,
  Feedback as ToolFeedback,
  Registry as ToolRegistry,
  TaskState,
  Task,
  WorkflowState,
  BaseResponse,
  FileOp,
  CommandOp,
} from 'llamautoma-types'

// Task types
export const TaskTypeSchema = z.enum([
  'code', // coder is writing code based on the plan
  'chat', // planner has decided no plan is needed, so we're just chatting
  'plan', // planner is creating a plan based on the conversation
  'review', // reviewer is reviewing the coder's output
  'summarize', // summarizer is summarizing the conversation
])
export type TaskType = z.infer<typeof TaskTypeSchema>

// Safety configuration schema and types
export const SafetyConfigSchema = z
  .object({
    requireToolConfirmation: z.boolean().default(true).optional(),
    requireToolFeedback: z.boolean().default(true).optional(),
    maxInputLength: z.number().min(1).default(8192).optional(),
    dangerousToolPatterns: z
      .array(z.string())
      .default([
        'drop',
        'truncate',
        'exec',
        'curl',
        'wget',
        'bash -c',
        'rm  -rf /',
        'zsh -c',
        'sh -c',
      ])
      .optional(),
  })
  .optional()

// Default agent configuration
export const DEFAULT_AGENT_CONFIG = {
  modelName: 'qwen2.5-coder:1.5b',
  host: 'http://localhost:11434',
  maxIterations: 10,
  userInputTimeout: 30000,
  safetyConfig: {
    requireToolConfirmation: true,
    requireToolFeedback: true,
    maxInputLength: 8192,
    dangerousToolPatterns: [
      'rm -rf /',
      'DROP TABLE',
      'sudo rm',
      'wget http',
      'curl',
      'exec',
      'bash -c',
      'zsh -c',
      'sh -c',
    ],
  },
}

// Base schema for all requests
export const BaseRequestSchema = z.object({
  threadId: z.string().optional(),
  checkpoint: z.string().optional(),
  modelName: z.string().optional(),
  host: z.string().optional(),
  safetyConfig: SafetyConfigSchema,
})

export type BaseRequest = z.infer<typeof BaseRequestSchema>

// Chat/Edit/Compose request schema
export const ChatRequestSchema = BaseRequestSchema.extend({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>

// Sync request schema
export const SyncRequestSchema = BaseRequestSchema.extend({
  root: z.string(),
  excludePatterns: z.array(z.string()).optional(),
})

export type SyncRequest = z.infer<typeof SyncRequestSchema>

// Base runnable configuration
export interface RunnableConfig extends Omit<LangChainRunnableConfig, 'configurable'> {
  modelName: string
  host: string
  threadId?: string
  checkpoint?: string
  safetyConfig?: {
    requireToolConfirmation: boolean
    requireToolFeedback: boolean
    maxInputLength: number
    dangerousToolPatterns: string[]
  }
  memoryPersist?: boolean
  configurable?: {
    thread_id: string
    checkpoint_ns: string
    [Symbol.toStringTag]: string
  }
}

// Streaming response types
export type StreamingResponse = {
  type: 'status' | 'result' | 'error' | 'chat'
  content: string | Record<string, any>
}

// Default values for tool results
export const DEFAULT_TOOL_RESULT: ToolResult = {
  success: true,
  output: undefined,
}

// Default values for safety check
export const DEFAULT_SAFETY_CHECK: SafetyCheck = {
  passed: true,
}

// Re-export shared types
export type {
  Message,
  Messages,
  SafetyCheck,
  ToolType,
  ToolParam,
  Tool,
  ToolCall,
  ToolResult,
  ToolFeedback,
  ToolRegistry,
  TaskState,
  Task,
  WorkflowState,
  BaseResponse,
  FileOp,
  CommandOp,
}

