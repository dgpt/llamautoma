import { BaseMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { llm } from '../llm'
import { logger } from '@/logger'
import type { SummarizerTaskOutput } from './schemas/tasks'
import type { TaskResponseContent } from 'llamautoma-types'

/**
 * Safely gets the string content from a message
 */
function getMessageString(msg: BaseMessage): string {
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map(c => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')
  return JSON.stringify(content)
}

export const summarizerTask = async ({
  messages,
  maxContextTokens,
}: {
  messages: BaseMessage[]
  maxContextTokens: number
}): Promise<SummarizerTaskOutput> => {
  // Separate system messages from other messages
  const systemMessages = messages.filter(msg => msg instanceof SystemMessage)
  const nonSystemMessages = messages.filter(msg => !(msg instanceof SystemMessage))

  // Get token count for non-system messages
  const tokenCounts = await Promise.all(
    nonSystemMessages.map(msg => llm.getNumTokens(getMessageString(msg)))
  )
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0)

  // If under token limit, return as is
  if (totalTokens <= maxContextTokens) {
    return {
      messages,
      summary: '',
      response: {
        type: 'info',
        content: 'No summarization needed - conversation within token limit.',
        shouldDisplay: true,
        timestamp: Date.now(),
        priority: 50,
      },
      streamResponses: [],
    }
  }

  logger.debug('Summarizing messages due to token limit:', {
    totalTokens,
    maxContextTokens,
    messageCount: nonSystemMessages.length,
  })

  // Format messages for summarization
  const messageText = nonSystemMessages
    .map(msg => `${msg instanceof AIMessage ? 'Assistant' : 'User'}: ${getMessageString(msg)}`)
    .join('\n\n')

  // Get summary from LLM
  const result = await llm.invoke([
    new SystemMessage({
      content: `You are a conversation summarizer. Your task is to create a concise but comprehensive summary of the conversation below.
Focus on key points, decisions, and important context that would be needed to continue the conversation.
The summary should be detailed enough that someone reading it would understand the full context and be able to continue the conversation appropriately.`,
    }),
    new SystemMessage({
      content: `Conversation to summarize:

${messageText}`,
    }),
  ])

  const summaryContent = getMessageString(result)

  // Return system messages plus summary
  return {
    messages: [...systemMessages, new AIMessage({ content: summaryContent })],
    summary: summaryContent,
    response: {
      type: 'info',
      content: 'Conversation summarized successfully.',
      shouldDisplay: true,
      timestamp: Date.now(),
      priority: 50,
    },
    streamResponses: [],
  }
}
