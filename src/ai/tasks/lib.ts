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
 * Helper to safely get message content as string
 */
export function getMessageString(msg: BaseMessage): string {
  const content = msg.content
  if (typeof content === 'string') {
    return content
  } else if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && 'text' in item) return item.text
        return ''
      })
      .join(' ')
  }
  return ''
}

// Re-export compression utilities for file content
export { encodeGeneratedFiles, decodeGeneratedFiles }