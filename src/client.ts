import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { logger } from './utils/logger'
import { v4 as uuidv4 } from 'uuid'
import { createReActAgent } from './agents/react/agent'
import { Tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { RunnableConfig } from '@langchain/core/runnables'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_AGENT_CONFIG } from './agents/react/types'

export interface LlamautomaChatOptions {
  stream?: boolean
  threadId?: string
  modelName?: string
  host?: string
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

  constructor() {
    this.memoryPersistence = new MemorySaver()
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

    const chatModel = new ChatOllama({
      model: options.modelName || DEFAULT_AGENT_CONFIG.modelName,
      baseUrl: options.host || DEFAULT_AGENT_CONFIG.host
    })

    return createReActAgent({
      modelName: options.modelName || DEFAULT_AGENT_CONFIG.modelName,
      host: options.host || DEFAULT_AGENT_CONFIG.host,
      threadId,
      maxIterations: DEFAULT_AGENT_CONFIG.maxIterations,
      memoryPersistence: this.memoryPersistence,
      userInputTimeout: DEFAULT_AGENT_CONFIG.userInputTimeout,
      configurable,
      chatModel,
      safetyConfig: DEFAULT_AGENT_CONFIG.safetyConfig
    })
  }

  private async runAgent(messages: BaseMessage[], options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    try {
      const threadId = options.threadId || uuidv4()
      logger.debug({ threadId }, 'Running agent')

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

      // Add initial system message if not present
      if (!messages.some(m => m instanceof SystemMessage)) {
        messages.unshift(new SystemMessage('You are a helpful AI assistant.'))
      }

      logger.debug('Creating agent stream')
      const stream = agent.streamEvents({
        messages,
        configurable: runConfig.configurable
      }, {
        version: 'v2',
        encoding: 'text/event-stream',
        configurable: runConfig.configurable
      })
      logger.debug('Stream created from agent events')

      // Create an async generator to process the stream
      const messageStream = this.createMessageStream(stream)

      // Get the first message
      const firstResult = await messageStream.next()
      const initialMessages = firstResult.value ? [firstResult.value] : []
      logger.debug({ hasFirstMessage: !!firstResult.value }, 'Initial message processed')

      // If we have no initial message, create a default one
      if (!initialMessages.length) {
        const defaultMessage = new AIMessage('<response type="chat"><content>I am ready to help.</content></response>')
        initialMessages.push(defaultMessage)
      }

      return {
        status: 'success',
        messages: initialMessages,
        threadId,
        stream: messageStream
      }
    } catch (error) {
      logger.error({ error }, 'Agent execution failed')
      return {
        status: 'error',
        messages: [new AIMessage(`<response type="error"><content>Error: ${error instanceof Error ? error.message : 'Unknown error'}</content></response>`)],
        threadId: options.threadId || uuidv4()
      }
    }
  }

  private async *createMessageStream(stream: AsyncIterable<any>): AsyncIterableIterator<BaseMessage> {
    logger.trace('Initializing message stream')
    const iterator = stream[Symbol.asyncIterator]()
    let messageCount = 0
    let currentMessage = ''
    let hasYieldedMessage = false
    let emptyChunkCount = 0
    const MAX_EMPTY_CHUNKS = 3

    try {
      logger.trace('Starting stream processing')
      while (true) {
        const { value, done } = await iterator.next()

        // Reset empty chunk count if we get a value
        if (value) {
          emptyChunkCount = 0
        } else {
          emptyChunkCount++
        }

        // Only break if we've hit max empty chunks AND we haven't yielded any messages
        if ((done || emptyChunkCount >= MAX_EMPTY_CHUNKS) && !hasYieldedMessage) {
          logger.trace('No messages found, sending default response')
          messageCount++
          yield new AIMessage('<response type="chat"><content>I am ready to help.</content></response>')
          hasYieldedMessage = true
          break
        }

        // Break if done and we've yielded at least one message
        if (done && hasYieldedMessage) {
          break
        }

        if (!value) {
          continue
        }

        let decodedValue = value
        if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
          logger.trace(`Decoding binary chunk (${value.byteLength} bytes)`)
          const decoder = new TextDecoder()
          decodedValue = decoder.decode(value)
        }

        // Try to parse as SSE data
        const sseMatch = typeof decodedValue === 'string' ? decodedValue.match(/data: ({.*})/s) : null
        if (sseMatch) {
          try {
            decodedValue = JSON.parse(sseMatch[1])
          } catch (e) {
            logger.error('Failed to parse SSE data')
          }
        }

        // Handle messages array
        if (decodedValue?.messages?.length > 0) {
          logger.trace(`Processing message batch (${decodedValue.messages.length})`)

          for (const msg of decodedValue.messages) {
            if (!msg.content) continue

            const content = msg.content.toString()
            // Format raw objects as XML
            let xmlContent
            if (content.match(/<response.*?<\/response>/s)) {
              xmlContent = content
            } else {
              // Try to parse event data first
              let responseType = 'chat'
              try {
                const eventData = typeof content === 'string' ? JSON.parse(content) : content
                if (eventData.event) {
                  switch (eventData.event) {
                    case 'on_tool_start':
                    case 'on_tool_end':
                      responseType = 'tool'
                      break
                    case 'on_chain_start':
                      if (eventData.name === 'react_agent') {
                        responseType = 'thought'
                      }
                      break
                    case 'on_chain_end':
                      if (eventData.name === 'react_agent') {
                        responseType = 'final'
                      }
                      break
                  }
                }
              } catch (e) {
                // If event parsing fails, try content-based detection
                if (content.includes('Tool execution requires confirmation') || content.includes('Tool:') || content.includes('Action:')) {
                  responseType = 'tool'
                } else if (content.includes('Edit file') || content.includes('Editing file') || content.includes('File edit:')) {
                  responseType = 'edit'
                } else if (content.includes('Create file') || content.includes('Creating file') || content.includes('New file:')) {
                  responseType = 'compose'
                } else if (content.includes('Directory:') || content.includes('Syncing') || content.includes('Sync:')) {
                  responseType = 'sync'
                } else if (content.includes('Thought:') || content.includes('Thinking:')) {
                  responseType = 'thought'
                } else if (content.includes('Final Answer:') || content.includes('Complete:')) {
                  responseType = 'final'
                }
              }
              xmlContent = `<response type="${responseType}"><content>${typeof content === 'object' ? JSON.stringify(content) : content}</content></response>`
            }

            // Check for complete XML messages
            const xmlMatches = xmlContent.match(/<response.*?<\/response>/gs)
            if (xmlMatches) {
              for (const match of xmlMatches) {
                logger.trace(`Processing message ${messageCount + 1} (type: ${match.match(/type="([^"]+)"/)?.[1] || 'unknown'})`)
                messageCount++
                yield new AIMessage(match)
                hasYieldedMessage = true

                // Only break on final/chat if we've seen multiple messages
                const type = match.match(/type="([^"]+)"/)?.[1]
                if (messageCount > 1 && (type === 'final' || type === 'chat')) {
                  logger.trace(`Found completion response after ${messageCount} messages - type: ${type}`)
                  return
                }
              }
            }
          }
        } else {
          // Handle raw value
          const content = decodedValue?.toString() || ''
          if (!content) continue

          // Format raw content as XML
          let xmlContent
          if (content.match(/<response.*?<\/response>/s)) {
            xmlContent = content
          } else if (typeof decodedValue === 'object') {
            xmlContent = `<response type="chat"><content>${JSON.stringify(decodedValue)}</content></response>`
          } else {
            // Try to extract response type from content
            let responseType = 'chat'
            if (content.includes('Tool execution requires confirmation') || content.includes('Tool:') || content.includes('Action:')) {
              responseType = 'tool'
            } else if (content.includes('Edit file') || content.includes('Editing file') || content.includes('File edit:')) {
              responseType = 'edit'
            } else if (content.includes('Create file') || content.includes('Creating file') || content.includes('New file:')) {
              responseType = 'compose'
            } else if (content.includes('Directory:') || content.includes('Syncing') || content.includes('Sync:')) {
              responseType = 'sync'
            } else if (content.includes('Thought:') || content.includes('Thinking:')) {
              responseType = 'thought'
            } else if (content.includes('Final Answer:') || content.includes('Complete:')) {
              responseType = 'final'
            }
            xmlContent = `<response type="${responseType}"><content>${content}</content></response>`
          }

          // Check for complete XML messages
          const xmlMatches = xmlContent.match(/<response.*?<\/response>/gs)
          if (xmlMatches) {
            for (const match of xmlMatches) {
              logger.trace(`Processing message ${messageCount + 1} (type: ${match.match(/type="([^"]+)"/)?.[1] || 'unknown'})`)
              messageCount++
              yield new AIMessage(match)
              hasYieldedMessage = true

              // Only break on final/chat if we've seen multiple messages
              const type = match.match(/type="([^"]+)"/)?.[1]
              if (messageCount > 1 && (type === 'final' || type === 'chat')) {
                logger.trace(`Found completion response after ${messageCount} messages - type: ${type}`)
                return
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Stream error: ${error?.constructor?.name}`)
      throw error
    } finally {
      // Ensure iterator is properly closed
      if (iterator.return) {
        await iterator.return()
      }
    }
  }

  async chat(message: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaResponse> {
    return this.runAgent([new HumanMessage(message)], options)
  }

  async edit(instruction: string, file: string, options: LlamautomaChatOptions = {}): Promise<LlamautomaEditResponse> {
    logger.debug('Editing file')
    const messages = [
      new HumanMessage(`File: ${file}\nInstruction: ${instruction}`)
    ]
    const result = await this.runAgent(messages, options)
    logger.debug('Edit result', { result })

    let edits: Array<{ file: string, changes: string[] }> = []

    if (result.stream) {
      logger.debug('Processing edit stream')
      const processedMessages: BaseMessage[] = []

      try {
        for await (const message of result.stream) {
          processedMessages.push(message)
          const content = message.content.toString()
          logger.debug('Processing message from stream', { content })

          if (content.includes('<response type="edit">')) {
            logger.debug('Found edit response', { content })
            const fileMatch = content.match(/<file>(.*?)<\/file>/s)
            const changes = Array.from(content.matchAll(/<change type="([^"]+)">\s*<location>(.*?)<\/location>\s*<content>(.*?)<\/content>\s*<\/change>/gs))
              .map(match => ({
                type: match[1],
                location: match[2],
                content: match[3]
              }))

            edits.push({
              file: fileMatch ? fileMatch[1].trim() : file,
              changes: changes.map(c => JSON.stringify(c))
            })
          }

          // Break if we see a final or chat response after finding edits
          if (edits.length > 0 && content.match(/<response type="(final|chat)">/)) {
            logger.debug('Found completion response after edits', { content })
            break
          }
      }
    } catch (error) {
        logger.error({ error }, 'Error processing edit stream')
        throw error
      } finally {
        // Ensure stream is properly closed
        if (result.stream.return) {
          await result.stream.return()
        }
      }

      // Update result messages with processed messages
      result.messages = processedMessages
    }

    logger.debug('Processed edits', { editCount: edits.length, edits })
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