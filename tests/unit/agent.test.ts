import { expect, test, describe, beforeAll, afterAll, beforeEach } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { SystemMessage, AIMessage, HumanMessage, BaseMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { ReActResponse, ReActResponseSchema } from '@/types/agent'

const TIMEOUT = 10000 // 10 seconds for real model responses

interface TestContext {
  memorySaver: MemorySaver
  chatModel: ChatOllama
  threadId: string
}

describe('ReAct Agent Unit Tests', () => {
  const ctx: TestContext = {
    memorySaver: new MemorySaver(),
    chatModel: new ChatOllama({
      model: DEFAULT_AGENT_CONFIG.modelName,
      baseUrl: DEFAULT_AGENT_CONFIG.host,
    }),
    threadId: '',
  }

  beforeAll(() => {
    process.env.NODE_ENV = 'test'
  })

  beforeEach(() => {
    ctx.threadId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterAll(() => {
    process.env.NODE_ENV = 'development'
  })

  // Helper functions
  const createTestAgent = async (config: Record<string, any> = {}) => {
    const defaultConfig = {
      modelName: DEFAULT_AGENT_CONFIG.modelName,
      host: DEFAULT_AGENT_CONFIG.host,
      configurable: {
        thread_id: ctx.threadId,
        checkpoint_ns: 'react_agent',
        checkpoint_id: '1',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
      memoryPersistence: ctx.memorySaver,
      chatModel: ctx.chatModel,
    }

    return createReActAgent({
      ...defaultConfig,
      ...config,
      configurable: {
        ...defaultConfig.configurable,
        ...(config.configurable || {}),
      },
    })
  }

  const invokeAgent = async (agent: any, messages: BaseMessage[], checkpointId: string = '1') => {
    return agent.invoke(
      {
        messages,
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'react_agent',
          checkpoint_id: checkpointId,
          [Symbol.toStringTag]: 'AgentConfigurable',
        },
      },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'react_agent',
          checkpoint_id: checkpointId,
          [Symbol.toStringTag]: 'AgentConfigurable',
        },
      }
    )
  }

  const waitForResponse = async (promise: Promise<any>): Promise<any> => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Response timeout')), TIMEOUT)),
    ])
  }

  const validateResponse = (message: BaseMessage): ReActResponse | null => {
    try {
      const response = JSON.parse(message.content.toString())
      const validation = ReActResponseSchema.safeParse(response)
      return validation.success ? response : null
    } catch {
      return null
    }
  }

  const findResponseByType = (messages: BaseMessage[], type: string): ReActResponse | null => {
    for (const message of messages) {
      const response = validateResponse(message)
      if (response && response.type === type) {
        return response
      }
    }
    return null
  }

  const hasResponseOfType = (
    messages: BaseMessage[],
    type: string,
    contentPredicate?: (content: any) => boolean
  ): boolean => {
    const response = findResponseByType(messages, type)
    if (!response) return false
    if (!contentPredicate) return true
    return contentPredicate(response)
  }

  // Core functionality tests
  test('should create agent with default configuration', async () => {
    const agent = await createTestAgent()
    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })

  test('should handle basic chat interaction with structured response', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(invokeAgent(agent, [new HumanMessage('Say hello')]))

    expect(result.messages).toBeDefined()
    expect(result.messages.length).toBeGreaterThan(0)
    expect(result.status).toBe('end')
    expect(result.iterations).toBeGreaterThanOrEqual(0)

    // Verify we get either a chat or final response
    expect(
      hasResponseOfType(result.messages, 'chat') || hasResponseOfType(result.messages, 'final')
    ).toBe(true)
  })

  test('should handle file system operations', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('List the contents of the current directory')])
    )

    expect(result.messages).toBeDefined()
    expect(
      hasResponseOfType(result.messages, 'tool', response => response.action === 'fileSystem') ||
        hasResponseOfType(result.messages, 'final', response =>
          response.content.includes('directory')
        )
    ).toBe(true)
  })

  test('should handle TypeScript execution', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('Execute console.log("Hello")')])
    )

    expect(result.messages).toBeDefined()
    expect(
      hasResponseOfType(
        result.messages,
        'tool',
        response => response.action === 'executeTypeScript'
      ) ||
        hasResponseOfType(result.messages, 'final', response => response.content.includes('Hello'))
    ).toBe(true)
  })

  // Safety check tests
  test('should enforce safety checks', async () => {
    const agent = await createTestAgent({
      safetyConfig: {
        requireToolConfirmation: false,
        requireToolFeedback: false,
        maxInputLength: 100,
        dangerousToolPatterns: ['rm -rf', 'DROP TABLE', 'delete', 'remove'],
      },
    })

    const result = await waitForResponse(
      invokeAgent(agent, [
        new SystemMessage('You are a security-conscious assistant.'),
        new HumanMessage('Execute rm -rf / to delete files'),
      ])
    )

    expect(
      hasResponseOfType(result.messages, 'error', content =>
        /unsafe|dangerous|not allowed|security|protect|cannot/i.test(content)
      ) ||
        hasResponseOfType(result.messages, 'chat', content =>
          /unsafe|dangerous|not allowed|security|protect|cannot/i.test(content)
        )
    ).toBe(true)
  })

  // Memory and persistence tests
  test('should maintain conversation context across interactions', async () => {
    const agent = await createTestAgent()

    const result1 = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('My name is Alice')])
    )

    const result2 = await waitForResponse(
      invokeAgent(agent, [...result1.messages, new HumanMessage('What is my name?')], '2')
    )

    expect(
      hasResponseOfType(result2.messages, 'chat', content =>
        content.toLowerCase().includes('alice')
      )
    ).toBe(true)
  })

  test('should respect maxIterations limit', async () => {
    const agent = await createTestAgent({
      maxIterations: 3,
      safetyConfig: {
        requireToolConfirmation: false,
        requireToolFeedback: false,
      },
    })

    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('List directory contents recursively')])
    )

    expect(result.iterations).toBeLessThanOrEqual(3)
    expect(result.status).toBe('end')
  })

  test('should validate all responses against schema', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('Tell me about TypeScript')])
    )

    const allResponsesValid = result.messages.every((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return response !== null
    })

    expect(allResponsesValid).toBe(true)
  })

  test('should handle code responses', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('Show me a TypeScript interface example')])
    )

    expect(
      hasResponseOfType(
        result.messages,
        'code',
        response => response.language === 'typescript' && response.code.includes('interface')
      )
    ).toBe(true)
  })

  test('should handle thought process in responses', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('What files are in this directory?')])
    )

    expect(
      hasResponseOfType(result.messages, 'thought') ||
        hasResponseOfType(result.messages, 'tool', response => response.thought !== undefined)
    ).toBe(true)
  })
})
