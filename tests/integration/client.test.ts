import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { LlamautomaClient } from '../../src/client'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../../src/utils/logger'
import { BaseMessage } from '@langchain/core/messages'

class StreamTestUtils {
  static async *processStream(stream: AsyncIterableIterator<BaseMessage>) {
    try {
      for await (const message of stream) {
        const content = message.content.toString()
        // Validate XML format
        if (!content.match(/<response type="[^"]+">.*?<\/response>/s)) {
          throw new Error('Invalid XML format in stream message')
        }
        yield message
      }
    } catch (error) {
      logger.error({ error }, 'Error processing stream')
      throw error
    } finally {
      if (stream.return) {
        await stream.return()
      }
    }
  }

  static async validateStreamResponse(stream: AsyncIterableIterator<BaseMessage>, options: {
    minMessages?: number
    maxMessages?: number
    timeout?: number
    expectedTypes?: string[]
  } = {}) {
    const {
      minMessages = 1,
      maxMessages = 10,
      timeout = 10000,
      expectedTypes = ['chat', 'thought', 'final']
    } = options

    let messageCount = 0
    const messages: BaseMessage[] = []
    const startTime = Date.now()

    try {
      const timeoutPromise = new Promise<BaseMessage[]>((_, reject) => {
        setTimeout(() => reject(new Error('Stream timeout')), timeout)
      })

      const streamPromise = (async () => {
        for await (const message of StreamTestUtils.processStream(stream)) {
          messages.push(message)
          messageCount++
          logger.debug('Processing stream message', { messageCount, content: message.content.toString() })

          const content = message.content.toString()
          const typeMatch = content.match(/<response type="([^"]+)">/s)
          expect(typeMatch).toBeDefined()
          if (typeMatch) {
            expect(expectedTypes).toContain(typeMatch[1])
          }

          // For edit tests, break after finding edit response and final/chat response
          if (expectedTypes.includes('edit')) {
            const hasEdit = messages.some(m => m.content.toString().includes('<response type="edit">'))
            if (hasEdit && typeMatch && ['final', 'chat'].includes(typeMatch[1])) {
              logger.debug('Found completion after edit response')
              break
            }
          }
          // For other tests, break on final/chat response
          else if (typeMatch && ['final', 'chat'].includes(typeMatch[1])) {
            logger.debug('Found completion response')
            break
          }

          if (messageCount >= maxMessages) {
            logger.debug('Reached max messages')
            break
          }
        }
        return messages
      })()

      await Promise.race([streamPromise, timeoutPromise])
    } catch (error: any) {
      if (error.message === 'Stream timeout' && messageCount >= minMessages) {
        logger.warn('Stream timed out but minimum messages received')
      } else {
        throw error
      }
    } finally {
      if (stream.return) {
        await stream.return()
      }
    }

    expect(messageCount).toBeGreaterThanOrEqual(minMessages)
    expect(messageCount).toBeLessThanOrEqual(maxMessages)
    return messages
  }
}

describe('Llamautoma Client Integration Tests', () => {
  let client: LlamautomaClient

  beforeEach(() => {
    logger.debug('Setting up client test')
    client = new LlamautomaClient()
    logger.debug('Client test setup complete')
  })

  afterEach(async () => {
    logger.debug('Cleaning up client test')
    client = new LlamautomaClient()
  })

  test('should handle chat interactions', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting chat interaction test')

    const response = await client.chat('What is the capital of France?', {
      threadId,
      configurable: {
        checkpoint_ns: 'chat-test'
      }
    })
    logger.debug({ status: response.status }, 'Chat response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 5,
        expectedTypes: ['chat', 'thought', 'final']
      })

      // Verify the last message is a final response
      const lastMessage = messages[messages.length - 1]
      expect(lastMessage.content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
    }
    logger.debug('Chat test complete')
  })

  test('should handle streaming responses with partial chunks', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting streaming test')

    const response = await client.chat('Tell me a story', {
      threadId,
      configurable: {
        checkpoint_ns: 'stream-test'
      }
    })
    logger.debug({ response }, 'Initial stream response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 3,
        expectedTypes: ['thought', 'chat', 'final']
      })
    }

    logger.debug('Streaming test complete')
  })

  test('should handle file editing with XML responses', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting file edit test')

    const response = await client.edit('Add a second line saying "Goodbye World"', 'test.txt', {
      threadId,
      configurable: {
        checkpoint_ns: 'edit-test'
      }
    })
    logger.debug({ status: response.status, editCount: response.edits?.length }, 'File edit response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 5,
        expectedTypes: ['thought', 'edit', 'final']
      })

      // Verify edit format
      const editMessage = messages.find(msg => msg.content.toString().includes('<response type="edit">'))
      expect(editMessage).toBeDefined()
      expect(editMessage?.content.toString()).toMatch(/<response type="edit">\s*<file>.*?<\/file>\s*<changes>\s*<change type="[^"]+">.*?<\/change>\s*<\/changes>\s*<\/response>/s)

      // Verify edits array is populated from stream
      expect(response.edits).toBeDefined()
      expect(response.edits.length).toBeGreaterThan(0)
      const edit = response.edits[0]
      expect(edit.file).toBe('test.txt')
      expect(edit.changes).toBeDefined()
      expect(edit.changes.length).toBeGreaterThan(0)

      // Verify change format
      const change = JSON.parse(edit.changes[0])
      expect(change.type).toMatch(/^(insert|update|delete)$/)
      expect(change.location).toBeDefined()
      expect(change.content).toBeDefined()
    }
  })

  test('should handle file composition with XML responses', async () => {
    const threadId = uuidv4()
    const response = await client.compose('Create a simple HTML file that displays "Hello World"', {
      threadId,
      configurable: {
        checkpoint_ns: 'compose-test'
      }
    })
    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 5,
        expectedTypes: ['thought', 'compose', 'final']
      })

      // Verify compose format
      const composeMessage = messages.find(msg => msg.content.toString().includes('<response type="compose">'))
      expect(composeMessage).toBeDefined()
      expect(composeMessage?.content.toString()).toMatch(/<response type="compose">\s*<file>\s*<path>.*?<\/path>\s*<content>.*?<\/content>\s*<\/file>\s*<\/response>/s)

      // Verify files array
      expect(response.files).toBeDefined()
      expect(response.files.length).toBeGreaterThan(0)
      const file = response.files[0]
      expect(file).toBeDefined()
      expect(typeof file.path).toBe('string')
      expect(typeof file.content).toBe('string')
      expect(file.path).toMatch(/\.html$/)
    }
  })

  test('should handle directory synchronization with XML responses', async () => {
    const response = await client.sync('test_dir', {
      threadId: uuidv4(),
      configurable: {
        checkpoint_ns: 'sync-test'
      }
    })
    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 5,
        expectedTypes: ['thought', 'sync', 'final']
      })

      // Verify sync format
      const syncMessage = messages.find(msg => msg.content.toString().includes('<response type="sync">'))
      expect(syncMessage).toBeDefined()
      expect(syncMessage?.content.toString()).toMatch(/<response type="sync">\s*<file>\s*<path>.*?<\/path>\s*<content>.*?<\/content>\s*<\/file>\s*<\/response>/s)

      // Verify files array
      expect(response.files).toBeDefined()
      expect(response.files.length).toBeGreaterThan(0)
      const file = response.files[0]
      expect(file).toBeDefined()
      expect(typeof file.path).toBe('string')
      expect(typeof file.content).toBe('string')
    }
  })

  test('should handle tool execution with XML responses', async () => {
    logger.debug('Starting tool execution test')
    const response = await client.chat('Use the test tool with "hello"', {
      threadId: uuidv4(),
      configurable: {
        checkpoint_ns: 'tool-test'
      }
    })
    logger.debug({ status: response.status }, 'Tool execution response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 2,
        maxMessages: 5,
        expectedTypes: ['thought', 'tool', 'observation', 'final']
      })

      // Verify tool call sequence
      const toolMessage = messages.find(msg => msg.content.toString().includes('<response type="tool">'))
      expect(toolMessage).toBeDefined()
      expect(toolMessage?.content.toString()).toMatch(/<response type="tool">\s*<thought>.*?<\/thought>\s*<action>.*?<\/action>\s*<args>.*?<\/args>\s*<\/response>/s)

      const observationMessage = messages.find(msg => msg.content.toString().includes('<response type="observation">'))
      expect(observationMessage).toBeDefined()
      expect(observationMessage?.content.toString()).toMatch(/<response type="observation">\s*<content>.*?Processed:.*?<\/content>\s*<\/response>/s)
    }
    logger.debug('Tool execution test complete')
  })

  test('should handle cross-thread persistence with XML responses', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()
    logger.debug({ threadId1, threadId2 }, 'Starting cross-thread test')

    logger.debug('Sending first message')
    const response1 = await client.chat('Remember that the sky is blue', {
      threadId: threadId1,
      configurable: {
        checkpoint_ns: 'cross-thread-test'
      }
    })
    expect(response1.status).toBe('success')
    expect(response1.stream).toBeDefined()

    if (response1.stream) {
      const messages1 = await StreamTestUtils.validateStreamResponse(response1.stream, {
        minMessages: 1,
        maxMessages: 3,
        expectedTypes: ['thought', 'chat', 'final']
      })
      expect(messages1[messages1.length - 1].content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
    }

    logger.debug('Sending second message')
    const response2 = await client.chat('What color is the sky?', {
      threadId: threadId2,
      configurable: {
        checkpoint_ns: 'cross-thread-test'
      }
    })

    expect(response2.status).toBe('success')
    expect(response2.stream).toBeDefined()

    if (response2.stream) {
      const messages2 = await StreamTestUtils.validateStreamResponse(response2.stream, {
        minMessages: 1,
        maxMessages: 3,
        expectedTypes: ['thought', 'chat', 'final']
      })
      expect(messages2[messages2.length - 1].content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*blue.*<\/content>\s*<\/response>/s)
    }
    logger.debug('Cross-thread test complete')
  })

  test('should handle user interaction with XML responses', async () => {
    const response = await client.chat('I need help with a task that requires user input', {
      stream: true,
      threadId: uuidv4(),
      configurable: {
        checkpoint_ns: 'user-interaction-test'
      }
    })

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
        minMessages: 1,
        maxMessages: 5,
        expectedTypes: ['thought', 'chat', 'final']
      })
      const lastMessage = messages[messages.length - 1].content.toString()
      expect(lastMessage).toMatch(/<response type="(chat|final)">\s*<content>.*?(input|confirm|proceed).*?<\/content>\s*<\/response>/s)
    }
  })
})
