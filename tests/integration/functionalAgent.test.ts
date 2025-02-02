import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { entrypoint } from '@langchain/langgraph'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { DynamicTool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { v4 as uuidv4 } from 'uuid'
import { AgentState } from '../../src/types/agent'
import { logger } from '../../src/utils/logger'
import { modelInvocationManager } from '../setup'

const DEFAULT_SAFETY_CONFIG = {
  requireToolConfirmation: false,
  requireToolFeedback: false,
  maxInputLength: 8192,
  dangerousToolPatterns: [] as string[]
}

describe('Functional ReAct Agent Integration Tests', () => {
  let chat: ChatOllama
  let checkpointer: MemorySaver
  let sharedMemory: Record<string, any> = {}

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    logger.trace('Setting up functional agent test')
    chat = new ChatOllama({
      model: 'qwen2.5-coder:1.5b',
      baseUrl: 'http://localhost:11434'
    })
    checkpointer = new MemorySaver()
    sharedMemory = {} // Reset shared memory
    logger.trace('Test setup complete')
  })

  afterEach(async () => {
    logger.trace('Cleaning up test')
    await modelInvocationManager.waitForInvocations()
    sharedMemory = {} // Clear shared memory
    process.env.NODE_ENV = 'development'
  })

  const createInitialState = (threadId: string, messages: HumanMessage[]): AgentState => {
    logger.trace(`Creating state for thread ${threadId}`)
    return {
      messages: [...(sharedMemory[threadId]?.messages || []), ...messages],
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
        [Symbol.toStringTag]: 'AgentConfigurable' as const,
        safetyConfig: DEFAULT_SAFETY_CONFIG
      }
    }
  }

  test('should handle basic chat interaction', async () => {
    const threadId = uuidv4()
    logger.trace(`Starting chat test ${threadId}`)
    let modelResponse: any = null

    try {
      const agent = entrypoint(
        {
          checkpointer,
          name: 'test_agent'
        },
        async (state: AgentState) => {
          logger.trace(`Processing state ${state.threadId}`)

          await modelInvocationManager.startInvocation(state.threadId)

          try {
            let cleanup: (() => void) | undefined
            try {
              const result = await Promise.race([
                chat.call(state.messages),
                new Promise<never>((_, reject) => {
                  const timeout = setTimeout(() => reject(new Error('Chat model timeout')), 5000)
                  cleanup = () => clearTimeout(timeout)
                })
              ])
              modelResponse = result
              logger.trace('Model response received')

              return {
                ...state,
                messages: [...state.messages, result],
                status: 'end' as const,
                modelResponse: result,
                isFinalAnswer: true,
                configurable: {
                  thread_id: state.threadId,
                  checkpoint_ns: 'test',
                  [Symbol.toStringTag]: 'AgentConfigurable' as const,
                  safetyConfig: DEFAULT_SAFETY_CONFIG
                }
              }
            } finally {
              cleanup?.()
            }
          } finally {
            modelInvocationManager.completeInvocation(state.threadId)
          }
        }
      )

      logger.trace('Invoking agent')
      const result = await agent.invoke(
        createInitialState(threadId, [new HumanMessage('Hello')]),
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'test',
            [Symbol.toStringTag]: 'AgentConfigurable' as const,
            safetyConfig: DEFAULT_SAFETY_CONFIG
          }
        }
      )
      logger.trace(`Agent response received (${result.messages.length} messages)`)

      expect(result.messages.length).toBeGreaterThan(1)
      expect(result.status).toBe('end')
    } finally {
      await modelInvocationManager.waitForInvocations()
    }
    logger.trace('Chat test complete')
  })

  test('should handle tool execution', async () => {
    const threadId = uuidv4()
    logger.trace(`Starting tool test ${threadId}`)

    const testTool = new DynamicTool({
      name: 'test-tool',
      description: 'A test tool',
      func: async (input: string) => `Processed: ${input}`
    })

    try {
      const agent = entrypoint(
        {
          checkpointer,
          name: 'test_agent'
        },
        async (state: AgentState) => {
          logger.trace('Executing test tool')

          await modelInvocationManager.startInvocation(state.threadId)

          try {
            let cleanup: (() => void) | undefined
            try {
              const result = await Promise.race([
                testTool.invoke('test input'),
                new Promise<never>((_, reject) => {
                  const timeout = setTimeout(() => reject(new Error('Tool execution timeout')), 5000)
                  cleanup = () => clearTimeout(timeout)
                })
              ])
              logger.trace('Tool execution complete')
              return {
                ...state,
                messages: [...state.messages, { role: 'assistant', content: result }],
                status: 'end' as const,
                modelResponse: { role: 'assistant', content: result },
                isFinalAnswer: true,
                configurable: {
                  thread_id: state.threadId,
                  checkpoint_ns: 'test',
                  [Symbol.toStringTag]: 'AgentConfigurable' as const
                }
              }
            } finally {
              cleanup?.()
            }
          } finally {
            modelInvocationManager.completeInvocation(state.threadId)
          }
        }
      )

      logger.trace('Invoking agent')
      const result = await agent.invoke(
        createInitialState(threadId, [new HumanMessage('Use the test tool')]),
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'test',
            [Symbol.toStringTag]: 'AgentConfigurable' as const
          }
        }
      )
      logger.trace(`Agent response received (${result.messages.length} messages)`)

      expect(result.messages.length).toBeGreaterThan(1)
      expect(result.messages[result.messages.length - 1].content).toContain('Processed:')
    } finally {
      await modelInvocationManager.waitForInvocations()
    }
    logger.trace('Tool test complete')
  })

  test('should handle cross-thread memory persistence', async () => {
    const threadId1 = uuidv4()
    const threadId2 = uuidv4()
    logger.trace(`Starting cross-thread test ${threadId1}, ${threadId2}`)

    const processState = async (state: AgentState) => {
      logger.trace(`Processing state ${state.threadId}`)

      await modelInvocationManager.startInvocation(state.threadId)

      try {
        let cleanup: (() => void) | undefined
        try {
          const result = await Promise.race([
            chat.call(state.messages),
            new Promise<never>((_, reject) => {
              const timeout = setTimeout(() => reject(new Error('Chat model timeout')), 5000)
              cleanup = () => clearTimeout(timeout)
            })
          ])

          if (!sharedMemory[state.threadId]) {
            sharedMemory[state.threadId] = { messages: [] }
          }
          sharedMemory[state.threadId].messages = [...state.messages, result]

          return {
            ...state,
            messages: sharedMemory[state.threadId].messages,
            status: 'end' as const,
            modelResponse: result,
            isFinalAnswer: true
          }
        } finally {
          cleanup?.()
        }
      } finally {
        modelInvocationManager.completeInvocation(state.threadId)
      }
    }

    try {
      logger.trace(`Processing first thread ${threadId1}`)
      const state1 = createInitialState(threadId1, [new HumanMessage('Remember that the sky is blue')])
      const result1 = await processState(state1)

      expect(result1.messages.length).toBeGreaterThan(1)
      expect(result1.status).toBe('end')

      logger.trace(`Processing second thread ${threadId2}`)
      const state2 = createInitialState(threadId2, [new HumanMessage('What color is the sky?')])
      const result2 = await processState(state2)

      expect(result2.messages.length).toBeGreaterThan(1)
      expect(result2.status).toBe('end')
      expect(result2.messages[result2.messages.length - 1].content).toContain('blue')
    } finally {
      await modelInvocationManager.waitForInvocations()
    }
    logger.trace('Cross-thread test complete')
  })
})