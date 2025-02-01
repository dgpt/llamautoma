import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { LlamautomaClient } from '../../src/client'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../../src/utils/logger'
import { BaseMessage } from '@langchain/core/messages'

describe('Llamautoma Client Integration Tests', () => {
  let client: LlamautomaClient

  beforeEach(() => {
    logger.debug('Setting up client test')
    client = new LlamautomaClient()
    logger.debug('Client test setup complete')
  })

  afterEach(async () => {
    logger.debug('Cleaning up client test')
    // Reset memory state by creating new instances
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
    expect(response.messages).toBeDefined()
    expect(response.messages.length).toBeGreaterThan(0)
    // Check the last message since that's the response
    const lastMessage = response.messages[response.messages.length - 1]
    expect(lastMessage.content.toString()).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
    logger.debug('Chat test complete')
  })

  test('should handle streaming responses', async () => {
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

    logger.debug('Processing stream')
    let messageCount = 0
    let lastMessage: BaseMessage | null = null
    const controller = new AbortController()
    const signal = controller.signal

    try {
      if (!response.stream) {
        throw new Error('Stream is undefined')
      }

      for await (const message of response.stream) {
        if (signal.aborted) {
          logger.debug('Stream aborted')
          break
        }
        logger.debug({ messageCount, content: message.content }, 'Received stream message')
        expect(message).toBeDefined()
        expect(message.content).toBeDefined()
        expect(message.content.toString()).toMatch(/<response type="(chat|thought|final)">\s*<content>.*?<\/content>\s*<\/response>/s)
        lastMessage = message
        messageCount++

        // Break after receiving at least one message to avoid hanging
        if (messageCount > 0) {
          logger.debug('Received sufficient messages, breaking stream')
          break
        }
      }

      logger.debug({ messageCount, lastMessageContent: lastMessage?.content }, 'Stream processing complete')
      expect(messageCount).toBeGreaterThan(0)
      expect(lastMessage).toBeDefined()
    } catch (error) {
      logger.error({ error }, 'Error processing stream')
      throw error
    } finally {
      controller.abort()
      // Ensure stream is properly closed
      if (response.stream?.return) {
        await response.stream.return()
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
        checkpoint_ns: 'edit-test'
      }
    })
    logger.debug({ status: response.status, editCount: response.edits?.length }, 'File edit response received')

    expect(response.status).toBe('success')
    expect(response.messages).toBeDefined()
    expect(response.messages.length).toBeGreaterThan(0)

    // Verify XML format in messages
    const editMessage = response.messages.find(msg => msg.content.toString().includes('<response type="edit">'))
    expect(editMessage).toBeDefined()
    expect(editMessage?.content.toString()).toMatch(/<response type="edit">\s*<file>.*?<\/file>\s*<changes>\s*<change type="[^"]+">.*?<\/change>\s*<\/changes>\s*<\/response>/s)

    // Verify edits array
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
    expect(response.files).toBeDefined()
    expect(response.files.length).toBeGreaterThan(0)

    const file = response.files[0]
    expect(file).toBeDefined()
    expect(typeof file.path).toBe('string')
    expect(typeof file.content).toBe('string')
    expect(file.path).toMatch(/\.html$/)

    // Verify XML format in messages
    const composeMessage = response.messages.find(msg => msg.content.toString().includes('<response type="compose">'))
    expect(composeMessage).toBeDefined()
    expect(composeMessage?.content.toString()).toMatch(/<response type="compose">\s*<file>\s*<path>.*?<\/path>\s*<content>.*?<\/content>\s*<\/file>\s*<\/response>/s)
  })

  test('should handle directory synchronization with XML responses', async () => {
    const response = await client.sync('test_dir', {
      threadId: uuidv4(),
      configurable: {
        checkpoint_ns: 'sync-test'
      }
    })
    expect(response.status).toBe('success')
    expect(response.files).toBeDefined()
    expect(response.files.length).toBeGreaterThan(0)

    const file = response.files[0]
    expect(file).toBeDefined()
    expect(typeof file.path).toBe('string')
    expect(typeof file.content).toBe('string')

    // Verify XML format in messages
    const syncMessage = response.messages.find(msg => msg.content.toString().includes('<response type="sync">'))
    expect(syncMessage).toBeDefined()
    expect(syncMessage?.content.toString()).toMatch(/<response type="sync">\s*<file>\s*<path>.*?<\/path>\s*<content>.*?<\/content>\s*<\/file>\s*<\/response>/s)
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

    // Verify tool call XML format
    const toolCallMessage = response.messages.find(msg => msg.content.toString().includes('<response type="tool">'))
    expect(toolCallMessage).toBeDefined()
    expect(toolCallMessage?.content.toString()).toMatch(/<response type="tool">\s*<thought>.*?<\/thought>\s*<action>.*?<\/action>\s*<args>.*?<\/args>\s*<\/response>/s)

    // Verify tool result XML format
    const toolResultMessage = response.messages.find(msg => msg.content.toString().includes('<response type="observation">'))
    expect(toolResultMessage).toBeDefined()
    expect(toolResultMessage?.content.toString()).toMatch(/<response type="observation">\s*<content>.*?Processed:.*?<\/content>\s*<\/response>/s)

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
    expect(response1.messages[0].content).toMatch(/<response type="(chat|final)">\s*<content>.*?<\/content>\s*<\/response>/s)

    logger.debug('Sending second message')
    const response2 = await client.chat('What color is the sky?', {
      threadId: threadId2,
      configurable: {
        checkpoint_ns: 'cross-thread-test'
      }
    })

    logger.debug({ status: response2.status }, 'Cross-thread response received')
    expect(response2.status).toBe('success')
    expect(response2.messages[response2.messages.length - 1].content).toMatch(/<response type="(chat|final)">\s*<content>.*blue.*<\/content>\s*<\/response>/s)
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
    const lastMessage = response.messages[response.messages.length - 1].content
    expect(lastMessage).toMatch(/<response type="(chat|final|thought)">\s*<content>.*?(input|confirm|proceed).*?<\/content>\s*<\/response>/s)
  })
})
