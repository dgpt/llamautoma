import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { logger } from './utils/logger'
import { v4 as uuidv4 } from 'uuid'
import { createReActAgent } from './agents/react/agent'
import { Tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph-checkpoint'

export interface LlamautomaChatOptions {
  stream?: boolean
  threadId?: string
  modelName?: string
  host?: string
  tools?: Tool[]
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
    return createReActAgent({
      modelName: options.modelName || 'qwen2.5-coder:7b',
      host: options.host || 'http://localhost:11434',
      tools: options.tools || this.defaultTools,
      threadId: options.threadId || uuidv4(),
      memoryPersistence: this.memoryPersistence,
      maxIterations: 10,
      userInputTimeout: 300000,
      safetyConfig: {
        requireToolConfirmation: true,
        requireToolFeedback: true,
        maxInputLength: 8192,
        dangerousToolPatterns: []
      }
    })
  }

  private async runAgent(messages: BaseMessage[], options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    try {
      const agent = this.createAgent(options)
      const threadId = options.threadId || uuidv4()

      if (options.stream) {
        const stream = agent.streamEvents({
          messages,
          configurable: { thread_id: threadId }
        }, {
          version: 'v2',
          encoding: 'text/event-stream',
          configurable: { thread_id: threadId }
        })

        return {
          status: 'success',
          messages: [],
          threadId,
          stream: this.createMessageStream(stream)
        }
      }

      const result = await agent.invoke({
        messages,
        configurable: { thread_id: threadId }
      })

      return {
        status: 'success',
        messages: result.messages,
        threadId: result.threadId
      }
    } catch (error) {
      logger.error({ error }, 'Agent execution failed')
      return {
        status: 'error',
        messages: [new AIMessage({ content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` })],
        threadId: options.threadId || uuidv4()
      }
    }
  }

  private createMessageStream(stream: AsyncIterable<any>): AsyncIterableIterator<BaseMessage> {
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of stream) {
            if (event.type === 'message') {
              const role = event.data.role || 'assistant'
              const content = event.data.content || ''
              switch (role) {
                case 'user':
                  yield new HumanMessage(content)
                  break
                case 'system':
                  yield new SystemMessage(content)
                  break
                default:
                  yield new AIMessage(content)
              }
            }
          }
        } catch (error) {
          logger.error({ error }, 'Stream processing failed')
          yield new AIMessage({ content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` })
        }
      },
      next() {
        const iterator = this[Symbol.asyncIterator]()
        return iterator.next()
      },
      return() {
        return Promise.resolve({ done: true as const, value: undefined })
      },
      throw(error: any) {
        return Promise.reject(error)
      }
    }
  }

  async chat(message: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    return this.runAgent([new HumanMessage(message)], options)
  }

  async edit(instruction: string, file: string): Promise<LlamautomaEditResponse> {
    const messages = [
      new SystemMessage('You are a code editing assistant. Edit the provided file based on the instruction.'),
      new HumanMessage(`File: ${file}\nInstruction: ${instruction}`)
    ]
    const result = await this.runAgent(messages)
    const edits = result.messages
      .filter(msg => msg.content.toString().includes('EDIT:'))
      .map(msg => {
        const content = msg.content.toString()
        const [_, file, ...changes] = content.split('\n')
        return {
          file: file.replace('EDIT:', '').trim(),
          changes: changes.map(c => c.trim())
        }
      })
    return { ...result, edits }
  }

  async compose(instruction: string): Promise<LlamautomaComposeResponse> {
    const messages = [
      new SystemMessage('You are a code composition assistant. Create new files based on the instruction.'),
      new HumanMessage(instruction)
    ]
    const result = await this.runAgent(messages)
    const files = result.messages
      .filter(msg => msg.content.toString().includes('FILE:'))
      .map(msg => {
        const content = msg.content.toString()
        const [_, path, ...contentLines] = content.split('\n')
        return {
          path: path.replace('FILE:', '').trim(),
          content: contentLines.join('\n').trim()
        }
      })
    return { ...result, files }
  }

  async sync(directory: string): Promise<LlamautomaSyncResponse> {
    const messages = [
      new SystemMessage('You are a code synchronization assistant. Process and embed the provided files.'),
      new HumanMessage(`Directory: ${directory}`)
    ]
    const result = await this.runAgent(messages)
    const files = result.messages
      .filter(msg => msg.content.toString().includes('SYNC:'))
      .map(msg => {
        const content = msg.content.toString()
        const [_, path, ...contentLines] = content.split('\n')
        return {
          path: path.replace('SYNC:', '').trim(),
          content: contentLines.join('\n').trim()
        }
      })
    return { ...result, files }
  }
}
