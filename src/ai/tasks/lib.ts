import { BaseMessage } from '@langchain/core/messages'
import { encodeGeneratedFiles, decodeGeneratedFiles } from '../../lib/compression'
import { z } from 'zod'
import { Tool } from '@langchain/core/tools'
import { ToolNode as LangGraphToolNode } from '@langchain/langgraph/prebuilt'

// Tool schemas
export const ToolInputSchema = z.object({
  tool: z.string(),
  input: z.record(z.any()),
})

export const ToolOutputSchema = z.object({
  output: z.any(),
})

export type ToolInput = z.infer<typeof ToolInputSchema>
export type ToolOutput = z.infer<typeof ToolOutputSchema>

// Re-export LangGraph's ToolNode type
export type ToolNode = LangGraphToolNode

/**
 * Safely gets the string content from a message
 */
export function getMessageString(msg: BaseMessage): string {
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map(c => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')
  return JSON.stringify(content)
}

/**
 * Extracts and parses JSON from a string
 */
export function extractAndParseJson(text: string): any {
  try {
    // First try parsing the entire string as JSON
    return JSON.parse(text)
  } catch {
    // If that fails, try to find JSON object in the string
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        throw new Error('Failed to parse JSON from response')
      }
    }
    throw new Error('No JSON object found in response')
  }
}

/**
 * Validates tool configuration
 */
export function validateToolConfig(tool: Tool): void {
  if (!tool.name || !tool.description) {
    throw new Error('Tool must have name and description')
  }
}

/**
 * Creates a tool node for use in LangGraph workflows
 */
export function createToolNode(tools: Tool[]): LangGraphToolNode {
  tools.forEach(validateToolConfig)
  return new LangGraphToolNode(tools)
}

// Re-export compression utilities for convenience
export { encodeGeneratedFiles, decodeGeneratedFiles }