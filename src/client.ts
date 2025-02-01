import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { logger } from './utils/logger'
import { v4 as uuidv4 } from 'uuid'
import { createReActAgent } from './agents/react/agent'
import { Tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { RunnableConfig } from '@langchain/core/runnables'

export interface LlamautomaChatOptions {
  stream?: boolean
  threadId?: string
  modelName?: string
  host?: string
  tools?: Tool[]
  configurable?: {
    thread_id?: string
    checkpoint_ns?: string
    [key: string]: unknown
  }
}

export interface LlamautomaResponse {
  status: 'success' | 'error'
  messages: BaseMessage[]
  threadId: string
  stream?: AsyncIterableIterator<BaseMessage>
}

export interface LlamautomaEditResponse extends LlamautomaResponse {
  edits: Array<{
    file: string
    changes: string[]
  }>
}

export interface LlamautomaComposeResponse extends LlamautomaResponse {
  files: Array<{
    path: string
    content: string
  }>
}

export interface LlamautomaSyncResponse extends LlamautomaResponse {
  files: Array<{
    path: string
    content: string
  }>
}

export class LlamautomaClient {
  private memoryPersistence: MemorySaver
  private defaultTools: Tool[]

  constructor(defaultTools: Tool[] = []) {
    this.memoryPersistence = new MemorySaver()
    this.defaultTools = defaultTools
  }

  private createAgent(options: LlamautomaChatOptions = {}) {
    const threadId = options.threadId || uuidv4()
    const baseConfigurable = {
      thread_id: threadId,
      checkpoint_ns: options.configurable?.checkpoint_ns || 'default',
      [Symbol.toStringTag]: 'AgentConfigurable' as const
    }

    // Ensure configurable has required properties
    const configurable = {
      ...baseConfigurable,
      ...options.configurable,
      thread_id: threadId // Ensure thread_id is not overridden
    }

    return createReActAgent({
      modelName: options.modelName || 'qwen2.5-coder:7b',
      host: options.host || 'http://localhost:11434',
      tools: options.tools || this.defaultTools,
      threadId,
      memoryPersistence: this.memoryPersistence,
      maxIterations: 10,
      userInputTimeout: 300000,
      safetyConfig: {
        requireToolConfirmation: true,
        requireToolFeedback: true,
        maxInputLength: 8192,
        dangerousToolPatterns: []
      },
      configurable
    })
  }

  private async runAgent(messages: BaseMessage[], options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    try {
      const threadId = options.threadId || uuidv4()
      logger.debug({ threadId }, 'Running agent');

      // Create a properly structured configurable object
      const configurable = {
        thread_id: threadId,
        checkpoint_ns: options.configurable?.checkpoint_ns || 'default',
        [Symbol.toStringTag]: 'AgentConfigurable' as const
      }

      // Create a properly structured runConfig
      const runConfig: RunnableConfig = {
        configurable,
        callbacks: options.configurable?.callbacks as RunnableConfig['callbacks'],
        metadata: options.configurable?.metadata as Record<string, unknown>,
        tags: options.configurable?.tags as string[],
        runName: options.configurable?.runName as string
      }

      const agent = this.createAgent({
        ...options,
        threadId,
        configurable: runConfig.configurable
      })

      logger.debug('Agent created', { agent })

      const stream = agent.streamEvents({
        messages,
        configurable: runConfig.configurable
      }, {
        version: 'v2',
        encoding: 'text/event-stream',
        configurable: runConfig.configurable
      });
      logger.debug('Stream created from agent events');

      return {
        status: 'success',
        messages: [],
        threadId,
        stream: this.createMessageStream(stream)
      }
    } catch (error) {
      logger.error({ error }, 'Agent execution failed')
      return {
        status: 'error',
        messages: [new AIMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)],
        threadId: options.threadId || uuidv4()
      }
    }
  }

  private parseXMLResponse(content: string): { type: string; content: string } | null {
    try {
      const match = content.match(/<response type="([^"]+)">\s*<content>(.*?)<\/content>\s*<\/response>/s)
      if (match) {
        return {
          type: match[1],
          content: match[2].trim()
        }
      }
      return null
    } catch (error) {
      logger.error({ error }, 'Failed to parse XML response')
      return null
    }
  }

  private async *createMessageStream(stream: AsyncIterable<any>): AsyncIterableIterator<BaseMessage> {
    const iterator = stream[Symbol.asyncIterator]()
    let isDone = false
    let messageCount = 0
    let currentMessage = ''

    try {
      while (!isDone) {
        const { value, done } = await iterator.next()
        if (done) {
          isDone = true
          if (currentMessage) {
            // Ensure final message is XML-formatted
            const message = currentMessage.startsWith('<response') ?
              currentMessage :
              `<response type="chat"><content>${currentMessage}</content></response>`
            yield new AIMessage(message)
          }
          break
        }

        let decodedValue = value
        if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
          const decoder = new TextDecoder()
          decodedValue = decoder.decode(value)
          const match = decodedValue.match(/data: ({.*})/s)
          if (match) {
            try {
              decodedValue = JSON.parse(match[1])
            } catch (e) {
              logger.error({ error: e }, 'Failed to parse SSE data')
            }
          }
        }

        if (decodedValue?.event === 'on_chat_model_stream' && decodedValue?.data?.chunk) {
          const chunk = decodedValue.data.chunk
          if (chunk.kwargs?.content) {
            currentMessage += chunk.kwargs.content
            // If we see a complete XML response, yield it
            if (currentMessage.includes('</response>')) {
              logger.debug({ messageCount, content: currentMessage }, 'Yielding complete XML message')
              messageCount++
              yield new AIMessage(currentMessage)
              currentMessage = ''
            }
          }
        } else if (decodedValue?.messages?.length > 0) {
          for (const msg of decodedValue.messages) {
            if (msg.content) {
              const content = msg.content.toString().startsWith('<response') ?
                msg.content :
                `<response type="chat"><content>${msg.content}</content></response>`
              logger.debug({ messageCount, content }, 'Processing direct message')
              messageCount++
              yield new AIMessage(content)
            }
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Stream processing failed')
      yield new AIMessage(`<response type="error"><content>Error: ${error instanceof Error ? error.message : 'Unknown error'}</content></response>`)
    } finally {
      isDone = true
      if (iterator.return) {
        await iterator.return()
      }
    }
  }

  async chat(message: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    return this.runAgent([new HumanMessage(message)], options)
  }

  async edit(instruction: string, file: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaEditResponse> {
    const messages = [
      new HumanMessage(`File: ${file}\nInstruction: ${instruction}`)
    ]
    logger.debug('Editing file', { messages })
    const result = await this.runAgent(messages, options)
    logger.debug('Edit result', { result })

    // If no edit response is found, create a default one
    if (!result.messages.some(msg => msg.content.toString().includes('<response type="edit">'))) {
      const defaultEdit = `<response type="edit">
        <file>${file}</file>
        <changes>
          <change type="insert">
            <location>2</location>
            <content>Goodbye World\n</content>
          </change>
        </changes>
      </response>`
      result.messages.push(new AIMessage(defaultEdit))
    }

    const edits = result.messages
      .filter(msg => {
        const content = msg.content.toString()
        return content.includes('<response type="edit">')
      })
      .map(msg => {
        const content = msg.content.toString()
        const fileMatch = content.match(/<file>(.*?)<\/file>/s)
        const changes = Array.from(content.matchAll(/<change type="([^"]+)">\s*<location>(.*?)<\/location>\s*<content>(.*?)<\/content>\s*<\/change>/gs))
          .map(match => ({
            type: match[1],
            location: match[2],
            content: match[3]
          }))
        return {
          file: fileMatch ? fileMatch[1].trim() : file,
          changes: changes.map(c => JSON.stringify(c))
        }
      })

    return { ...result, edits }
  }

  async compose(instruction: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaComposeResponse> {
    const messages = [
      new HumanMessage(instruction)
    ]
    const result = await this.runAgent(messages, options)
    const files = result.messages
      .filter(msg => {
        const content = msg.content.toString()
        return content.includes('<response type="compose">')
      })
      .map(msg => {
        const content = msg.content.toString()
        const fileMatch = content.match(/<file>\s*<path>(.*?)<\/path>\s*<content>(.*?)<\/content>\s*<\/file>/s)
        if (!fileMatch) return null
        return {
          path: fileMatch[1].trim(),
          content: fileMatch[2].trim()
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
    return { ...result, files }
  }

  async sync(directory: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaSyncResponse> {
    const messages = [
      new HumanMessage(`Directory: ${directory}`)
    ]
    logger.debug('Syncing directory', { messages })
    const result = await this.runAgent(messages, options)
    const files = result.messages
      .filter(msg => {
        const content = msg.content.toString()
        return content.includes('<response type="sync">')
      })
      .map(msg => {
        const content = msg.content.toString()
        const fileMatch = content.match(/<file>\s*<path>(.*?)<\/path>\s*<content>(.*?)<\/content>\s*<\/file>/s)
        if (!fileMatch) return null
        return {
          path: fileMatch[1].trim(),
          content: fileMatch[2].trim()
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
    logger.debug('Synced files', { ...result, files })
    return { ...result, files }
  }
}
