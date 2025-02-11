import { BaseMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { createLLM } from '../llm'
import { logger } from '@/logger'
import { task } from '@langchain/langgraph'
import { SummarizerTaskSchema } from './schemas/tasks'
import { TaskType } from '@/types'
import type { RunnableConfig } from '@/types'
import { getMessageString } from './lib'

/**
 * Summarizes conversation history when it gets too long
 */
export const summarizerTask = task(
  'summarizer',
  async (
    input: {
      messages: BaseMessage[]
      maxContextTokens: number
    },
    config?: RunnableConfig
  ) => {
    if (!config?.config) {
      throw new Error('Config is required for summarizer task')
    }

    // Create LLM instance
    const llm = createLLM(TaskType.Summarize, config.config)

    // Separate system messages from other messages
    const systemMessages = input.messages.filter(msg => msg instanceof SystemMessage)
    const nonSystemMessages = input.messages.filter(msg => !(msg instanceof SystemMessage))

    // Get token count for non-system messages
    const tokenCounts = await Promise.all(
      nonSystemMessages.map(msg => llm.getNumTokens(getMessageString(msg)))
    )
    const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0)

    // If under token limit, return as is
    if (totalTokens <= input.maxContextTokens) {
      return SummarizerTaskSchema.parse({
        messages: input.messages,
        summary: '',
        response: {
          content: 'No summarization needed - conversation within token limit.',
          type: 'info',
          shouldDisplay: true,
          timestamp: Date.now(),
        },
        streamResponses: [],
      })
    }

    logger.debug('Summarizing messages due to token limit:', {
      totalTokens,
      maxContextTokens: input.maxContextTokens,
      messageCount: nonSystemMessages.length,
    })

    // Format messages for summarization
    const messageText = nonSystemMessages
      .map(msg => `${msg instanceof AIMessage ? 'Assistant' : 'User'}: ${getMessageString(msg)}`)
      .join('\n\n')

    try {
      // Get summary from LLM
      const result = await llm.invoke(
        [
          new SystemMessage({
            content: `You are a conversation summarizer. Your task is to create a concise but comprehensive summary of the conversation below.
Focus on key points, decisions, and important context that would be needed to continue the conversation.
The summary should be detailed enough that someone reading it would understand the full context and be able to continue the conversation appropriately.`,
          }),
          new SystemMessage({
            content: `Conversation to summarize:

${messageText}`,
          }),
        ],
        config
      )

      const summaryContent = getMessageString(result)

      // Return system messages plus summary
      return SummarizerTaskSchema.parse({
        messages: [...systemMessages, new AIMessage({ content: summaryContent })],
        summary: summaryContent,
        response: {
          content: 'Successfully summarized conversation history.',
          type: 'info',
          shouldDisplay: true,
          timestamp: Date.now(),
        },
        streamResponses: [
          {
            content: 'Summarizing conversation history...',
            type: 'progress',
            shouldDisplay: true,
            timestamp: Date.now(),
          },
          {
            content: summaryContent,
            type: 'info',
            shouldDisplay: true,
            timestamp: Date.now(),
          },
        ],
      })
    } catch (error) {
      logger.error('Error summarizing conversation:', error)
      throw new Error(
        `Failed to summarize conversation: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
)
