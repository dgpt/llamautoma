import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { SummarySchema } from 'llamautoma-types'
import type { Summary } from 'llamautoma-types'
import { getMessageString } from './lib'
import { logger } from '@/logger'

// Create summarizer with structured output
const summarizer = createStructuredLLM<Summary>(SummarySchema)

// Create the summarizer task
export const summarizerTask = task(
  'summarizer',
  async ({ messages }: { messages: BaseMessage[] }): Promise<Summary> => {
    // Combine all messages into a single context
    const context = messages
      .map(msg => {
        if (msg instanceof SystemMessage) return `System: ${getMessageString(msg)}`
        if (msg instanceof HumanMessage) return `Human: ${getMessageString(msg)}`
        if (msg instanceof AIMessage) return `Assistant: ${getMessageString(msg)}`
        return `${msg.constructor.name}: ${getMessageString(msg)}`
      })
      .join('\n')

    logger.debug(`Summarizing ${messages.length} messages`)

    // Generate summary using structured LLM
    const result = await summarizer.invoke([
      new SystemMessage(
        `You are a conversation summarizer. Your job is to condense long conversations while preserving key technical details and requirements.

Requirements:
1. Preserve all technical requirements and specifications
2. Keep important context and decisions
3. Remove redundant or unnecessary details
4. Focus on the most recent and relevant information
5. Maintain clear and concise language

The summary MUST be significantly shorter than the original conversation.
The summary should focus on the most recent and relevant technical details.
Ensure the summary maintains all key requirements and decisions.

Conversation to summarize:
${context}
`
      ),
    ])

    logger.debug(`Generated summary: ${result.summary}`)

    // Return summarized context
    return {
      messages: [
        messages[0], // Keep system message
        new AIMessage({ content: result.summary }),
      ],
      summary: result.summary,
    }
  }
)
