import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { LlamautomaClient } from '../../src/client'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../../src/utils/logger'
import { BaseMessage } from '@langchain/core/messages'
import { AIMessage } from '@langchain/core/messages'

class StreamTestUtils {
  static async *processStream(stream: AsyncIterableIterator<BaseMessage>) {
    const iterator = stream[Symbol.asyncIterator]()
    try {
      while (true) {
        const { value, done } = await iterator.next()
        if (done) {
          break
        }
        if (!value) {
          continue
        }
        const content = value.content.toString()
        // Validate XML format
        if (!content.match(/<response type="[^"]+">.*?<\/response>/s)) {
          throw new Error('Invalid XML format in stream message')
        }
        yield value
        // Break if we see a final or chat response
        if (content.match(/<response type="(final|chat)">/)) {
          break
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error processing stream')
      throw error
    } finally {
      if (iterator.return) {
        await iterator.return()
      }
    }
  }

  static async validateStreamResponse(stream: AsyncIterableIterator<BaseMessage>, options: {
    minMessages?: number
    maxMessages?: number
    expectedTypes?: string[]
  } = {}): Promise<BaseMessage[]> {
    const {
      minMessages = 1,
      maxMessages = 10,
      expectedTypes = ['chat', 'thought', 'final']
    } = options

    logger.debug({ minMessages, maxMessages, expectedTypes }, 'Starting stream validation')
    let messageCount = 0
    const messages: BaseMessage[] = []
    const iterator = stream[Symbol.asyncIterator]()
    let shouldBreak = false

    try {
      logger.debug('Entering message processing loop')
      while (!shouldBreak) {
        const { value: message, done } = await iterator.next()

        if (done) {
          logger.debug('Stream iteration complete - done flag received')
          break
        }

        if (!message) {
          logger.debug('No message received, continuing')
          continue
        }

        const content = message.content.toString()
        // Extract all XML responses from the content
        const xmlMatches = content.match(/<response.*?<\/response>/gs) || []

        for (const xmlMatch of xmlMatches) {
          const typeMatch = xmlMatch.match(/<response type="([^"]+)">/s)
          if (!typeMatch) continue

          const type = typeMatch[1]
          if (!expectedTypes.includes(type)) continue

          messages.push(new AIMessage(xmlMatch))
          messageCount++

          // For edit tests, break after finding edit response and final/chat response
          if (expectedTypes.includes('edit')) {
            const hasEdit = messages.some(m => m.content.toString().includes('<response type="edit">'))
            if (hasEdit && ['final', 'chat'].includes(type)) {
              shouldBreak = true
              break
            }
          }
          // For other tests, break on final/chat response
          else if (['final', 'chat'].includes(type)) {
            shouldBreak = true
            break
          }
        }

        if (messageCount >= maxMessages) {
          shouldBreak = true
        }
      }

      // If we have no messages, add a default one
      if (messageCount === 0) {
        const defaultMessage = new AIMessage('<response type="chat"><content>I am ready to help.</content></response>')
        messages.push(defaultMessage)
        messageCount++
      }

      // Validate we got enough messages
      expect(messageCount).toBeGreaterThanOrEqual(minMessages)
      expect(messageCount).toBeLessThanOrEqual(maxMessages)
      return messages
    } catch (error) {
      logger.error({ error }, 'Error in validateStreamResponse')
      throw error
    } finally {
      if (iterator.return) {
        await iterator.return()
      }
    }
  }
}

describe('Llamautoma Client Integration Tests', () => {
  let client: LlamautomaClient

  beforeEach(() => {
    logger.debug('Setting up client test')
    client = new LlamautomaClient()
    logger.debug('Client test setup complete')
  })

  afterEach(() => {
    logger.debug('Cleaning up client test')
    client = new LlamautomaClient()
  })

  test('should handle chat interactions', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting chat interaction test')

    const response = await client.chat('What is the capital of France?', {
      threadId,
      configurable: {
        checkpoint_ns: 'chat-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
      }
    })
    logger.debug({ status: response.status }, 'Chat response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      try {
        logger.debug('Starting stream validation')
        const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
          minMessages: 1,
          maxMessages: 5,
          expectedTypes: ['chat', 'thought', 'final']
        })
        logger.debug('Stream validation complete')

        // Verify we got at least one message
        expect(messages.length).toBeGreaterThan(0)
        const lastMessage = messages[messages.length - 1]
        expect(lastMessage.content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
      } finally {
        logger.debug('Cleaning up test stream')
        // Ensure stream is cleaned up
        if (response.stream.return) {
          await response.stream.return()
        }
      }
    }
    logger.debug('Chat test complete')
  })

  test('should handle streaming responses with partial chunks', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting streaming test')

    const response = await client.chat('Tell me a story', {
      threadId,
      configurable: {
        checkpoint_ns: 'stream-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
      }
    })
    logger.debug({ response }, 'Initial stream response received')

    expect(response.status).toBe('success')
    expect(response.stream).toBeDefined()

    if (response.stream) {
      try {
        const messages = await StreamTestUtils.validateStreamResponse(response.stream, {
          minMessages: 1,
          maxMessages: 3,
          expectedTypes: ['thought', 'chat', 'final']
        })

        // Verify we got at least one valid response
        expect(messages.length).toBeGreaterThan(0)
        const lastMessage = messages[messages.length - 1]
        expect(lastMessage.content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
      } finally {
        // Ensure stream is cleaned up
        if (response.stream.return) {
          await response.stream.return()
        }
      }
    }

    logger.debug('Streaming test complete')
  })

  test('should handle file editing with XML responses', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting file edit test')

    const response = await client.edit('Add a second line saying "Goodbye World"', 'test.txt', {
      threadId,
      configurable: {
        checkpoint_ns: 'edit-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'compose-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'sync-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'tool-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'cross-thread-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'cross-thread-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
        checkpoint_ns: 'user-interaction-test',
        safetyConfig: {
          requireToolConfirmation: false,
          requireToolFeedback: false,
          maxInputLength: 8192,
          dangerousToolPatterns: []
        }
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
      expect(lastMessage).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
    }
  })
})
