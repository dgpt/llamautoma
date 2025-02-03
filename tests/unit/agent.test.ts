import { expect, test, describe, beforeAll, afterAll, beforeEach } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { SystemMessage, HumanMessage, BaseMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG } from '@/types/agent'
import { ReActResponse, ReActResponseSchema, AgentInput } from '@/types/agent'
import { entrypoint } from '@langchain/langgraph'

const TIMEOUT = 60000 // 60 seconds for real model responses

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
    ctx.memorySaver = new MemorySaver()
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
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
      memoryPersistence: ctx.memorySaver,
      chatModel: ctx.chatModel,
      maxIterations: 3,
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

  const invokeAgent = async (agent: any, messages: BaseMessage[], config?: Record<string, any>) => {
    return agent.invoke(
      {
        messages,
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'react_agent',
          [Symbol.toStringTag]: 'AgentConfigurable',
          ...config,
        },
      },
      {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'react_agent',
          [Symbol.toStringTag]: 'AgentConfigurable',
          ...config,
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
    contentPredicate?: (response: ReActResponse) => boolean
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
    expect(result.threadId).toBe(ctx.threadId)
    expect(result.configurable).toBeDefined()
    expect(result.configurable.thread_id).toBe(ctx.threadId)

    expect(
      hasResponseOfType(result.messages, 'chat') || hasResponseOfType(result.messages, 'final')
    ).toBe(true)
  })

  test('should handle thought process in responses', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [
        new SystemMessage('Always explain your thinking step by step.'),
        new HumanMessage('What is 2 + 2 and why?'),
      ])
    )

    expect(
      hasResponseOfType(result.messages, 'thought') ||
        hasResponseOfType(result.messages, 'chat', (response): boolean => {
          return (
            response.type === 'chat' &&
            response.content.toLowerCase().includes('2') &&
            response.content.toLowerCase().includes('4')
          )
        })
    ).toBe(true)
  })

  // Memory and persistence tests using LangGraph functional API
  test('should maintain conversation context across interactions using workflow memory', async () => {
    const workflowConfig = {
      thread_id: ctx.threadId,
      checkpoint_ns: 'memory_test',
      [Symbol.toStringTag]: 'AgentConfigurable' as const,
    }

    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'memory_test_workflow',
      },
      async (inputs: AgentInput) => {
        const agent = await createTestAgent({
          configurable: workflowConfig,
        })
        return await agent.invoke(inputs, {
          configurable: workflowConfig,
        })
      }
    )

    // First interaction
    const result1 = await waitForResponse(
      workflow.invoke(
        {
          messages: [new HumanMessage('Remember that my name is Alice')],
          configurable: workflowConfig,
        } as AgentInput,
        {
          configurable: workflowConfig,
        }
      )
    )

    expect(result1.threadId).toBe(ctx.threadId)
    expect(
      hasResponseOfType(result1.messages, 'chat', (response): boolean => {
        return response.type === 'chat' && response.content.toLowerCase().includes('alice')
      })
    ).toBe(true)

    // Second interaction using same workflow
    const result2 = await waitForResponse(
      workflow.invoke(
        {
          messages: [...result1.messages, new HumanMessage('What is my name?')],
          configurable: workflowConfig,
        } as AgentInput,
        {
          configurable: workflowConfig,
        }
      )
    )

    expect(result2.threadId).toBe(ctx.threadId)
    expect(
      hasResponseOfType(result2.messages, 'chat', (response): boolean => {
        return response.type === 'chat' && response.content.toLowerCase().includes('alice')
      })
    ).toBe(true)
  })

  test('should handle cross-thread memory isolation', async () => {
    const createWorkflowConfig = (threadId: string) => ({
      thread_id: threadId,
      checkpoint_ns: 'isolation_test',
      [Symbol.toStringTag]: 'AgentConfigurable' as const,
    })

    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'isolation_test_workflow',
      },
      async (inputs: AgentInput) => {
        const workflowConfig = createWorkflowConfig(inputs.configurable?.thread_id || '')
        const agent = await createTestAgent({
          configurable: workflowConfig,
        })
        return await agent.invoke(inputs, {
          configurable: workflowConfig,
        })
      }
    )

    // Thread 1
    const thread1Id = `thread1-${Date.now()}`
    const thread1Config = createWorkflowConfig(thread1Id)
    const result1 = await waitForResponse(
      workflow.invoke(
        {
          messages: [new HumanMessage('My name is Bob')],
          configurable: thread1Config,
        } as AgentInput,
        {
          configurable: thread1Config,
        }
      )
    )

    expect(result1.threadId).toBe(thread1Id)

    // Thread 2 (different thread)
    const thread2Id = `thread2-${Date.now()}`
    const thread2Config = createWorkflowConfig(thread2Id)
    const result2 = await waitForResponse(
      workflow.invoke(
        {
          messages: [new HumanMessage('What is my name?')],
          configurable: thread2Config,
        } as AgentInput,
        {
          configurable: thread2Config,
        }
      )
    )

    expect(result2.threadId).toBe(thread2Id)

    // Thread 2 should not know about Bob
    expect(
      !hasResponseOfType(result2.messages, 'chat', (response): boolean => {
        return response.type === 'chat' && response.content.toLowerCase().includes('bob')
      }) &&
        !hasResponseOfType(result2.messages, 'final', (response): boolean => {
          return response.type === 'final' && response.content.toLowerCase().includes('bob')
        })
    ).toBe(true)
  })

  test('should respect maxIterations limit', async () => {
    const agent = await createTestAgent({
      maxIterations: 2,
      safetyConfig: {
        requireToolConfirmation: false,
        requireToolFeedback: false,
      },
    })

    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('Tell me about TypeScript')])
    )

    expect(result.iterations).toBeLessThanOrEqual(2)
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

  test('should handle checkpoint persistence across agent instances', async () => {
    // First agent instance
    const agent1 = await createTestAgent()
    const result1 = await waitForResponse(
      invokeAgent(agent1, [new HumanMessage('Remember that my favorite color is blue')])
    )

    expect(result1.threadId).toBe(ctx.threadId)

    // Second agent instance with same thread ID
    const agent2 = await createTestAgent()
    const result2 = await waitForResponse(
      invokeAgent(agent2, [...result1.messages, new HumanMessage('What is my favorite color?')])
    )

    expect(result2.threadId).toBe(ctx.threadId)
    expect(
      hasResponseOfType(result2.messages, 'chat', (response): boolean => {
        return response.type === 'chat' && response.content.toLowerCase().includes('blue')
      })
    ).toBe(true)
  })
})
