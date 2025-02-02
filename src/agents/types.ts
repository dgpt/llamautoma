import { Tool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { ChatOllama } from '@langchain/ollama'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { RunnableConfig } from '@langchain/core/runnables'

export interface SafetyConfig {
  requireToolConfirmation?: boolean
  requireToolFeedback?: boolean
  maxInputLength?: number
  dangerousToolPatterns?: string[]
}

export interface AgentConfigurable {
  thread_id: string
  checkpoint_ns: string
  [Symbol.toStringTag]: 'AgentConfigurable'
  [key: string]: unknown
}

export interface AgentInput {
  messages: BaseMessage[]
  configurable?: AgentConfigurable
}

export interface AgentOutput {
  messages: BaseMessage[]
  status: 'continue' | 'end'
  toolFeedback: Record<string, unknown>
  iterations: number
  threadId: string
  configurable: AgentConfigurable
}

export interface AgentState {
  messages: BaseMessage[]
  iterations: number
  status: 'continue' | 'end'
  isFinalAnswer: boolean
  safetyConfig: SafetyConfig
  tools: Tool[]
  chatModel: ChatOllama
  maxIterations: number
  threadId: string
  configurable: AgentConfigurable
  modelResponse: BaseMessage | null
  action: { name: string; arguments: Record<string, unknown> } | null
  observation: string | null
  toolFeedback: Record<string, unknown>
  userConfirmed: boolean
  streamComplete?: boolean
}

export interface FunctionalReActConfig {
  modelName?: string
  host?: string
  threadId: string
  configurable?: AgentConfigurable
  maxIterations?: number
  memoryPersistence?: MemorySaver
  userInputTimeout?: number
  chatModel?: ChatOllama
  safetyConfig?: SafetyConfig
}

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: string
}

export interface SafetyCheckResult {
  passed: boolean
  reason?: string
}

export interface UserInteractionResult {
  confirmed: boolean
  feedback?: string
}

export interface MemoryManagerConfig {
  persistence: MemorySaver
  namespace: string
  threadId: string
}

export interface ToolExecutorConfig {
  safetyConfig: SafetyConfig
  runConfig?: RunnableConfig
}

export const DEFAULT_AGENT_CONFIG = {
  modelName: 'llama2',
  host: 'http://localhost:11434',
  maxIterations: 10,
  userInputTimeout: 30000,
  safetyConfig: {
    requireToolConfirmation: true,
    requireToolFeedback: true,
    maxInputLength: 8192,
    dangerousToolPatterns: [
      'rm -rf',
      'sudo',
      'chmod',
      'chown',
      'mkfs',
      'dd',
      '> /dev/',
      '> /proc/',
      '> /sys/'
    ]
  }
} as const