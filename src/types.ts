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
  Registry as ToolRegistry,
  TaskState,
  Task,
  WorkflowState,
  BaseResponse,
  FileOp,
  CommandOp,
} from 'llamautoma-types'
import { Config, ConfigSchema } from './config'

// Task types
export enum TaskType {
  Code = 'code', // coder is writing code based on the plan
  Chat = 'chat', // planner has decided no plan is needed, so we're just chatting
  Plan = 'plan', // planner is creating a plan based on the conversation
  Review = 'review', // reviewer is reviewing the coder's output
  Summarize = 'summarize', // summarizer is summarizing the conversation
  Intent = 'intent', // intent classifier for determining request type
}

// Base schema for all requests
export const BaseRequestSchema = z
  .object({
    threadId: z.string().optional(),
    checkpoint: z.string().optional(),
  })
  .merge(ConfigSchema.partial())

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
  config: Config
  threadId?: string
  checkpoint?: string
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
  ToolRegistry,
  TaskState,
  Task,
  WorkflowState,
  BaseResponse,
  FileOp,
  CommandOp,
}

