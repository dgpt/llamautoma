import { BaseMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'
import { Tool } from '@langchain/core/tools'
import { RunnableConfig } from '@langchain/core/runnables'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { SafetyConfig } from '../../types/agent'

/**
 * Default configuration values for the ReAct Agent
 */
export const DEFAULT_AGENT_CONFIG = {
  modelName: 'qwen2.5-coder:7b',
  host: 'http://localhost:11434',
  maxIterations: 10,
  userInputTimeout: 30000,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  maxEntries: 1000,
  relevancyThreshold: 0.7,
  safetyConfig: {
    requireToolConfirmation: true,
    requireToolFeedback: true,
    maxInputLength: 8192,
    dangerousToolPatterns: [] as string[]
  } as const
} as const

/**
 * Configuration for the ReAct Agent
 */
export interface ReActAgentConfig {
  /** Name of the Ollama model to use */
  modelName?: string
  /** Host URL for the Ollama server */
  host?: string
  /** Maximum number of iterations before forced completion */
  maxIterations?: number
  /** Unique identifier for the agent thread */
  threadId: string
  /** Chat model to use */
  chatModel?: BaseChatModel
  /** Memory persistence configuration */
  memoryPersistence: MemorySaver
  /** Timeout for user input in milliseconds */
  userInputTimeout?: number
  /** Safety configuration */
  safetyConfig?: SafetyConfig
  /** Maximum age of memory entries in milliseconds */
  maxAge?: number
  /** Maximum number of memory entries to keep */
  maxEntries?: number
  /** Threshold for memory relevancy */
  relevancyThreshold?: number
  /** Configurable parameters */
  configurable: Required<RunnableConfig>['configurable']
}

/**
 * Result of a safety check
 */
export interface SafetyCheckResult {
  /** Whether the input passed the safety check */
  passed: boolean
  /** Reason for failure if the check didn't pass */
  reason?: string
}

/**
 * State of the agent during execution
 */
export interface AgentState {
  /** Message history */
  messages: BaseMessage[]
  /** Number of iterations completed */
  iterations: number
  /** Thread identifier */
  threadId: string
  /** Current status of the agent */
  status: 'continue' | 'end'
  /** Record of tool call reviews */
  toolCallReviews?: Record<string, string>
  /** User input */
  userInput?: string
  /** Safety configuration */
  safetyConfig: SafetyConfig
  /** Record of tool feedback */
  toolFeedback: Record<string, string>
  /** Current model response */
  modelResponse: BaseMessage | null
  /** Current action to execute */
  action: ToolAction | null
  /** Whether the current response is a final answer */
  isFinalAnswer: boolean
  /** Result of the latest safety check */
  safetyResult?: SafetyCheckResult
  /** Whether the user confirmed the current action */
  userConfirmed: boolean
  /** Result of the latest tool execution */
  observation: string | null
  /** Configurable parameters */
  configurable?: RunnableConfig['configurable']
  /** Maximum number of iterations before forced completion */
  maxIterations: number
  /** Chat model used by the agent */
  chatModel: BaseChatModel
  /** Tools available to the agent */
  tools: Tool[]
}

/**
 * Result of a tool execution
 */
export interface ToolExecutionResult {
  /** Whether the tool execution was successful */
  success: boolean
  /** Result message or error message */
  output: string
  /** Error object if execution failed */
  error?: Error
  /** Result of safety checks if performed */
  safetyResult?: SafetyCheckResult
}

/**
 * Tool call extracted from model response
 */
export interface ToolCall {
  /** Name of the tool to call */
  name: string
  /** Arguments for the tool call */
  args: string
}

/**
 * Response from the model
 */
export interface ModelResponse {
  /** Content of the response */
  content: string
  /** Tool calls extracted from the response */
  toolCalls?: ToolCall[]
}

/**
 * Agent output interface
 */
export interface AgentOutput {
  /** Messages exchanged during the agent's execution */
  messages: BaseMessage[]
  /** Final status of the agent's execution */
  status: 'continue' | 'end'
  /** Optional feedback from tool executions */
  toolFeedback?: Record<string, string>
  /** Iterations completed */
  iterations?: number
  /** Thread identifier */
  threadId?: string
  /** Content of the final response */
  content?: string
  /** Configurable parameters */
  configurable?: {
    threadId?: string
    [key: string]: unknown
  }
}

/**
 * Tool executor configuration
 */
export interface ToolExecutorConfig {
  /** Safety configuration */
  safetyConfig?: SafetyConfig
  /** Timeout for user input in milliseconds */
  userInputTimeout?: number
}

export interface AgentInput {
  messages: BaseMessage[]
  configurable?: RunnableConfig['configurable']
}

export interface ToolAction {
  name: string
  arguments: string
}

export interface AgentAction {
  tool: string
  action: string
  args?: Record<string, any>
}

export interface AgentObservation {
  type: string
  content: any
}

export interface AgentResponse {
  success: boolean
  content?: string
  actions?: AgentAction[]
  observations?: AgentObservation[]
  requiresUserInput?: boolean
  pendingUserAction: {
    type: string
    data?: any
  }
  messages?: BaseMessage[]
}
