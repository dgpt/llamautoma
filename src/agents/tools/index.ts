import { TypeScriptExecutionTool } from './typescriptExecutionTool'

/**
 * All available tools for the ReAct agent
 */
const AGENT_TOOLS = [new TypeScriptExecutionTool()]

/**
 * Type for all available tools
 */
export type AgentTool = (typeof AGENT_TOOLS)[number]

export default AGENT_TOOLS
