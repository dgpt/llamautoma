import { FileSystemTool } from '@/agents/tools/fileSystemTool'
import { TypeScriptExecutionTool } from '@/agents/tools/typescriptExecutionTool'

/**
 * All available tools for the ReAct agent
 */
export const AGENT_TOOLS = [
  new FileSystemTool(),
  new TypeScriptExecutionTool()
] as const

/**
 * Type for all available tools
 */
export type AgentTool = typeof AGENT_TOOLS[number]

export default AGENT_TOOLS