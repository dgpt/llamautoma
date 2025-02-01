import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { entrypoint } from '@langchain/langgraph'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage } from '@langchain/core/messages'
import { DynamicTool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { v4 as uuidv4 } from 'uuid'
import { AgentState } from '../../src/types/agent'
import { logger } from '../../src/utils/logger'

const DEFAULT_SAFETY_CONFIG = {
  requireToolConfirmation: true,
  requireToolFeedback: true,
  maxInputLength: 8192,
  dangerousToolPatterns: [] as string[]
}

describe('Functional ReAct Agent Integration Tests', () => {
  let chat: ChatOllama
  let checkpointer: MemorySaver

  beforeEach(() => {
    logger.debug('Setting up functional agent test')
    chat = new ChatOllama({
      model: 'qwen2.5-coder:1.5b',
      baseUrl: 'http://localhost:11434'
    })
    checkpointer = new MemorySaver()
    logger.debug('Functional agent test setup complete')
  })

  afterEach(async () => {
    logger.debug('Cleaning up functional agent test')
  })

  const createInitialState = (threadId: string, messages: HumanMessage[]): AgentState => {
    logger.debug({ threadId }, 'Creating initial state')
    return {
      messages,
      status: 'continue',
      iterations: 0,
      modelResponse: null,
      action: null,
      observation: null,
      toolFeedback: {},
      userConfirmed: false,
      isFinalAnswer: false,
      threadId,
      safetyConfig: DEFAULT_SAFETY_CONFIG,
      tools: [],
      chatModel: chat,
      maxIterations: 10,
      configurable: {
        thread_id: threadId,
        checkpoint_ns: 'test',
        [Symbol.toStringTag]: 'AgentConfigurable' as const
      }
    }
  }

  test('should handle basic chat interaction', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting basic chat test')

    const agent = entrypoint(
      {
        checkpointer,
        name: 'test_agent'
      },
      async (state: AgentState) => {
        logger.debug('Invoking chat model')
        const result = await chat.invoke(state.messages)
        logger.debug('Chat model response received')
        return {
          ...state,
          messages: [...state.messages, result],
          status: 'end' as const,
          modelResponse: result,
          isFinalAnswer: true
        }
      }
    )

    logger.debug('Invoking agent')
    const result = await agent.invoke(
      createInitialState(threadId, [new HumanMessage('Hello')])
    )
    logger.debug({ messageCount: result.messages.length }, 'Agent response received')

    expect(result.messages.length).toBeGreaterThan(1)
    expect(result.status).toBe('end')
    logger.debug('Basic chat test complete')
  })

  test('should handle tool execution', async () => {
    const threadId = uuidv4()
    logger.debug({ threadId }, 'Starting tool execution test')

    const testTool = new DynamicTool({
      name: 'test-tool',
      description: 'A test tool',
      func: async (input: string) => `Processed: ${input}`
    })

    const agent = entrypoint(
      {
        checkpointer,
        name: 'test_agent'
      },
      async (state: AgentState) => {
        logger.debug('Invoking test tool')
        const result = await testTool.invoke('test input')
        logger.debug('Tool execution complete')
        return {
          ...state,
          messages: [...state.messages, { role: 'assistant', content: result }],
          status: 'end' as const,
          modelResponse: { role: 'assistant', content: result },
          isFinalAnswer: true
        }
      }
    )

    logger.debug('Invoking agent')
    const result = await agent.invoke(
      createInitialState(threadId, [new HumanMessage('Use the test tool')])
    )
    logger.debug({ messageCount: result.messages.length }, 'Agent response received')

    expect(result.messages.length).toBeGreaterThan(1)
    expect(result.messages[result.messages.length - 1].content).toContain('Processed:')
    logger.debug('Tool execution test complete')
  })

  test('should handle cross-thread memory persistence', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()
    logger.debug({ threadId1, threadId2 }, 'Starting cross-thread test')

    const agent = entrypoint(
      {
        checkpointer,
        name: 'test_agent'
      },
      async (state: AgentState) => {
        logger.debug('Invoking chat model')
        const result = await chat.invoke(state.messages)
        logger.debug('Chat model response received')
        return {
          ...state,
          messages: [...state.messages, result],
          status: 'end' as const,
          modelResponse: result,
          isFinalAnswer: true
        }
      }
    )

    logger.debug('Storing message in thread 1')
    await agent.invoke(
      createInitialState(threadId1, [new HumanMessage('Remember that the sky is blue')])
    )

    logger.debug('Retrieving from thread 2')
    const result = await agent.invoke(
      createInitialState(threadId2, [new HumanMessage('What color is the sky?')])
    )
    logger.debug({ messageCount: result.messages.length }, 'Cross-thread response received')

    expect(result.messages[result.messages.length - 1].content).toContain('blue')
    logger.debug('Cross-thread test complete')
  })
})