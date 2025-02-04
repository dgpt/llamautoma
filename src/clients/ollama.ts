import { ChatOllama } from '@langchain/ollama'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { logRequest, logResponse, startTimer, endTimer } from '@/logger'
import { v4 as uuidv4 } from 'uuid'

export class LoggedChatOllama extends ChatOllama {
  async invoke(messages: BaseMessage[], config?: RunnableConfig) {
    const threadId = config?.configurable?.thread_id || uuidv4()
    const url = `${this.baseUrl}/api/chat`

    startTimer(threadId)
    logRequest(threadId, 'POST', url, { messages })

    try {
      const response = await super.invoke(messages, config)
      const elapsedMs = endTimer(threadId) || 0
      logResponse(threadId, url, 200, elapsedMs)
      return response
    } catch (error) {
      const elapsedMs = endTimer(threadId) || 0
      logResponse(threadId, url, error instanceof Error ? 500 : 400, elapsedMs)
      throw error
    }
  }
}
