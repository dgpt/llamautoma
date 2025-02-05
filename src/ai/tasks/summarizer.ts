import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { llm } from '../llm'
import { getMessageString } from './lib'

// Schema for summarizer output
export interface SummarizerOutput {
  messages: BaseMessage[]
  summary: string
}

// Create the summarizer task
export const summarizerTask = task(
  'summarizer',
  async ({ messages }: { messages: BaseMessage[] }): Promise<SummarizerOutput> => {
    // Combine all messages into a single context
    const context = messages
      .map(msg => {
        if (msg instanceof SystemMessage) return `System: ${getMessageString(msg)}`
        if (msg instanceof HumanMessage) return `Human: ${getMessageString(msg)}`
        if (msg instanceof AIMessage) return `Assistant: ${getMessageString(msg)}`
        return `${msg.constructor.name}: ${getMessageString(msg)}`
      })
      .join('\n')

    // Generate summary using LLM
    const response = await llm.invoke(
      `Summarize the following conversation while preserving key technical details and requirements:

${context}

Summary:`
    )

    const summaryText = getMessageString(response)

    // Return summarized context as a single message
    return {
      messages: [
        messages[0], // Keep system message
        new AIMessage({ content: summaryText }),
      ],
      summary: summaryText,
    }
  }
)
