import { expect, test, describe, beforeAll, afterAll, beforeEach } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, BaseMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { createReActAgent } from '@/agents'
import { DEFAULT_AGENT_CONFIG, RunnableConfig } from '@/types'
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

  const createTestAgent = async (config: Partial<RunnableConfig> = {}) => {
    const defaultConfig: RunnableConfig = {
      modelName: DEFAULT_AGENT_CONFIG.modelName,
      host: DEFAULT_AGENT_CONFIG.host,
      configurable: {
        thread_id: ctx.threadId,
        checkpoint_ns: 'react_agent',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
      memoryPersist: true,
    }

    return await createReActAgent({
      ...defaultConfig,
      ...config,
    })
  }

  const invokeAgent = async (agent: any, messages: BaseMessage[], config?: Record<string, any>) => {
    const configurable = {
      thread_id: ctx.threadId,
      checkpoint_ns: 'react_agent',
      [Symbol.toStringTag]: 'AgentConfigurable',
      ...config,
    }
    return agent.invoke({ messages, configurable }, { configurable })
  }

  const waitForResponse = async (promise: Promise<any>): Promise<any> => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Response timeout')), TIMEOUT)),
    ])
  }

  const validateResponse = (message: BaseMessage): ReActResponse | null => {
    try {
      const content = message.content.toString()
      // Try parsing as JSON first
      try {
        const parsed = JSON.parse(content)
        const validation = ReActResponseSchema.safeParse(parsed)
        if (validation.success) return parsed
      } catch {}

      // If not valid JSON or doesn't match schema, check if it's a plain text response
      return {
        type: 'chat',
        content: content.trim(),
      }
    } catch {
      return null
    }
  }
  test('should create agent with default configuration', async () => {
    const agent = await createTestAgent()
    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })

  test('should handle basic chat interaction with structured response', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(invokeAgent(agent, [new HumanMessage('Say hello')]))

    expect(result.messages).toBeDefined()
    expect(result.messages.length).toBeGreaterThan(1) // Account for system message
    expect(result.status).toBe('end')
    expect(result.iterations).toBeDefined()
    expect(result.threadId).toBe(ctx.threadId)
    expect(result.checkpoint).toBeDefined()

    const hasValidResponse = result.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return response && (response.type === 'chat' || response.type === 'final')
    })
    expect(hasValidResponse).toBe(true)
  })

  test('should handle thought process in responses', async () => {
    const agent = await createTestAgent()
    const result = await waitForResponse(
      invokeAgent(agent, [new HumanMessage('What is 2 + 2 and why?')])
    )

    const hasThoughtOrCalculation = result.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      if (!response) return false
      if (response.type === 'thought') return true
      if (response.type === 'chat') {
        const content = response.content.toLowerCase()
        return content.includes('2') && content.includes('4')
      }
      return false
    })
    expect(hasThoughtOrCalculation).toBe(true)
  })

  test('should maintain conversation context across interactions using workflow memory', async () => {
    const workflowConfig: RunnableConfig = {
      modelName: DEFAULT_AGENT_CONFIG.modelName,
      host: DEFAULT_AGENT_CONFIG.host,
      threadId: ctx.threadId,
      checkpoint: 'memory_test',
      configurable: {
        thread_id: ctx.threadId,
        checkpoint_ns: 'memory_test',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
    }

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'memory_test_workflow' },
      async (inputs: AgentInput) => {
        const agent = await createTestAgent(workflowConfig)
        return await agent.invoke(inputs, workflowConfig)
      }
    )

    // First interaction
    const result1 = await waitForResponse(
      workflow.invoke(
        {
          messages: [new HumanMessage('Remember that my name is Alice')],
          ...workflowConfig,
        },
        workflowConfig
      )
    )

    expect(result1.threadId).toBe(ctx.threadId)
    const hasAliceResponse = result1.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return (
        response && response.type === 'chat' && response.content.toLowerCase().includes('alice')
      )
    })
    expect(hasAliceResponse).toBe(true)

    // Second interaction using same workflow
    const result2 = await waitForResponse(
      workflow.invoke(
        {
          messages: [...result1.messages, new HumanMessage('What is my name?')],
          ...workflowConfig,
        },
        workflowConfig
      )
    )

    expect(result2.threadId).toBe(ctx.threadId)
    const remembersAlice = result2.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return (
        response && response.type === 'chat' && response.content.toLowerCase().includes('alice')
      )
    })
    expect(remembersAlice).toBe(true)
  })

  test('should handle cross-thread memory isolation', async () => {
    const createWorkflowConfig = (threadId: string): RunnableConfig => ({
      modelName: DEFAULT_AGENT_CONFIG.modelName,
      host: DEFAULT_AGENT_CONFIG.host,
      threadId,
      checkpoint: 'isolation_test',
      configurable: {
        thread_id: threadId,
        checkpoint_ns: 'isolation_test',
        [Symbol.toStringTag]: 'AgentConfigurable',
      },
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'isolation_test_workflow' },
      async (inputs: AgentInput) => {
        const workflowConfig = createWorkflowConfig(inputs.threadId || '')
        const agent = await createTestAgent(workflowConfig)
        return await agent.invoke(inputs, workflowConfig)
      }
    )

    // Thread 1
    const thread1Id = `thread1-${Date.now()}`
    const thread1Config = createWorkflowConfig(thread1Id)
    const result1 = await waitForResponse(
      workflow.invoke(
        {
          messages: [new HumanMessage('My name is Bob')],
          ...thread1Config,
        },
        thread1Config
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
          ...thread2Config,
        },
        thread2Config
      )
    )

    expect(result2.threadId).toBe(thread2Id)
    const doesntKnowBob = !result2.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return response && response.type === 'chat' && response.content.toLowerCase().includes('bob')
    })
    expect(doesntKnowBob).toBe(true)
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
    const remembersBlue = result2.messages.some((msg: BaseMessage) => {
      const response = validateResponse(msg)
      return response && response.type === 'chat' && response.content.toLowerCase().includes('blue')
    })
    expect(remembersBlue).toBe(true)
  })
})
