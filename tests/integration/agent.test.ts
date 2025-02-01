import { expect, test, describe, beforeEach } from 'bun:test'
import { entrypoint, task, MemorySaver } from '@langchain/langgraph'
import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { ReActAgent } from '../../src/agents/react/agent'
import { MemoryManager } from '../../src/agents/react/memory/memoryManager'
import { FileSystemTool } from '../../src/agents/react/tools/fileSystemTool'
import { BaseReActTool } from '../../src/agents/react/tools/baseTool'
import { TEST_CONFIG } from '../testConfig'
import { v4 as uuidv4 } from 'uuid'
import { AgentOutput, ReActAgentConfig } from '../../src/agents/react/types'
import { z } from 'zod'
import { UserInteractionManager } from '../../src/agents/react/interaction/userInteractionManager'

interface WorkflowInput {
  messages: BaseMessage[];
  threadId: string;
}

describe('ReAct Agent Integration Tests', () => {
  let agent: ReActAgent
  let memory: MemoryManager
  let chat: ChatOllama
  let fileSystemTool: FileSystemTool

  beforeEach(() => {
    chat = new ChatOllama({
      model: 'qwen2.5-coder:1.5b',
      baseUrl: 'http://localhost:11434',
    })
    memory = new MemoryManager()
    fileSystemTool = new FileSystemTool()
    agent = new ReActAgent({
      chatModel: chat,
      llm: chat,
      memory,
      tools: [fileSystemTool],
    } as ReActAgentConfig)
  })

  test(
    'should handle safety checks and dangerous tool patterns',
    async () => {
      const threadId = uuidv4()
      const checkpointer = new MemorySaver()
      const dangerousPatterns = ['rm -rf', 'DROP TABLE', 'DELETE FROM']

      const agentWithSafety = new ReActAgent({
        chatModel: chat,
        llm: chat,
        memory,
        tools: [fileSystemTool],
        safetyConfig: {
          requireToolConfirmation: true,
          requireToolFeedback: true,
          dangerousToolPatterns: dangerousPatterns,
        },
      } as ReActAgentConfig)

      const workflow = entrypoint(
        { checkpointer, name: 'safety-test' },
        async (inputs: { messages: BaseMessage[] }): Promise<AgentOutput> => {
          const result = await agentWithSafety.execute(inputs.messages)
          return {
            messages: [...inputs.messages, new AIMessage(result.content || '')],
            status: result.success ? 'continue' : 'end',
            toolFeedback: {},
            iterations: 1,
            threadId,
            configurable: {
              thread_id: threadId,
              checkpoint_ns: 'safety-test',
            },
          }
        }
      )

      // Test dangerous pattern detection
      const dangerousResponse = await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Execute this command: rm -rf /'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'safety-test',
          },
        }
      )

      expect(dangerousResponse.status).toBe('continue')
      expect(dangerousResponse.messages[dangerousResponse.messages.length - 1].content).toBeDefined()
      expect(dangerousResponse.messages[dangerousResponse.messages.length - 1].content).toMatch(
        /dangerous|delete|system/i
      )

      // Test safe pattern passes
      const safeResponse = await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Read the contents of test.txt'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'safety-test',
          },
        }
      )

      expect(safeResponse.status).toBe('continue')
      expect(safeResponse.messages[safeResponse.messages.length - 1].content).toBeDefined()
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle memory persistence and retrieval',
    async () => {
      const threadId = uuidv4()
      const checkpointer = new MemorySaver()

      // Create a workflow that uses memory
      const workflow = entrypoint(
        { checkpointer, name: 'memory-test' },
        async (inputs: { messages: BaseMessage[] }): Promise<AgentOutput> => {
          const result = await agent.execute(inputs.messages)
          return {
            messages: [...inputs.messages, new AIMessage(result.content || '')],
            status: result.success ? 'continue' : 'end',
            toolFeedback: {},
            iterations: 1,
            threadId,
            configurable: {
              thread_id: threadId,
              checkpoint_ns: 'memory-test',
            },
          }
        }
      )

      // First interaction - store information
      await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('My name is Alice and I like blue.'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'memory-test',
          },
        }
      )

      // Second interaction - retrieve information
      const response = await workflow.invoke(
        {
          messages: [new HumanMessage('What is my name and what color do I like?')],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'memory-test',
          },
        }
      )

      expect(response.messages[response.messages.length - 1].content).toContain('Alice')
      expect(response.messages[response.messages.length - 1].content).toContain('blue')

      // Test memory cleanup
      await memory.clear()
      const clearedMemory = await memory.get(threadId)
      expect(clearedMemory).toBeUndefined()
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should validate tool inputs and handle errors',
    async () => {
      const threadId = uuidv4()
      const checkpointer = new MemorySaver()

      class TestTool extends BaseReActTool {
        name = 'test'
        description = 'A test tool'

        protected async execute(input: string): Promise<string> {
          const parsed = JSON.parse(input)
          if (!parsed.value) {
            throw new Error('Missing required value')
          }
          return `Processed: ${parsed.value}`
        }
      }

      const testTool = new TestTool()
      const agentWithTestTool = new ReActAgent({
        chatModel: chat,
        llm: chat,
        memory,
        tools: [testTool],
      } as ReActAgentConfig)

      const workflow = entrypoint(
        { checkpointer, name: 'tool-validation-test' },
        async (inputs: { messages: BaseMessage[] }): Promise<AgentOutput> => {
          const result = await agentWithTestTool.execute(inputs.messages)
          return {
            messages: [...inputs.messages, new AIMessage(result.content || '')],
            status: result.success ? 'continue' : 'end',
            toolFeedback: {},
            iterations: 1,
            threadId,
            configurable: {
              thread_id: threadId,
              checkpoint_ns: 'tool-validation-test',
            },
          }
        }
      )

      // Test invalid input
      const invalidResponse = await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Use the test tool with invalid input'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'tool-validation-test',
          },
        }
      )

      expect(invalidResponse.status).toBe('continue')
      expect(invalidResponse.messages[invalidResponse.messages.length - 1].content).toBeDefined()

      // Test valid input
      const validResponse = await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Use the test tool with value "hello"'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'tool-validation-test',
          },
        }
      )

      expect(validResponse.status).toBe('continue')
      expect(validResponse.messages[validResponse.messages.length - 1].content).toBeDefined()
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle cross-thread persistence and memory sharing',
    async () => {
      const threadId1 = uuidv4()
      const threadId2 = uuidv4()
      const checkpointer = new MemorySaver()

      const workflow = entrypoint(
        { checkpointer, name: 'cross-thread-test' },
        async (inputs: WorkflowInput): Promise<AgentOutput> => {
          const result = await agent.execute(inputs.messages)
          return {
            messages: [...inputs.messages, new AIMessage(result.content || '')],
            status: result.success ? 'continue' : 'end',
            toolFeedback: {},
            iterations: 1,
            threadId: inputs.threadId,
            configurable: {
              thread_id: inputs.threadId,
              checkpoint_ns: 'cross-thread-test',
            },
          }
        }
      )

      // Store information in thread 1
      await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Store this fact: The sky is blue'),
          ],
          threadId: threadId1,
        },
        {
          configurable: {
            thread_id: threadId1,
            checkpoint_ns: 'cross-thread-test',
          },
        }
      )

      // Retrieve information from thread 2
      const response = await workflow.invoke(
        {
          messages: [new HumanMessage('What is the sky color?')],
          threadId: threadId2,
        },
        {
          configurable: {
            thread_id: threadId2,
            checkpoint_ns: 'cross-thread-test',
          },
        }
      )

      expect(response.messages[response.messages.length - 1].content).toBe('The sky is blue')
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle tool call review and safety checks',
    async () => {
      const threadId = uuidv4()
      const checkpointer = new MemorySaver()

      const agentWithSafety = new ReActAgent({
        chatModel: chat,
        llm: chat,
        memory,
        tools: [fileSystemTool],
        safetyConfig: {
          requireToolConfirmation: true,
          requireToolFeedback: true,
          dangerousToolPatterns: ['rm -rf', 'DROP TABLE', 'DELETE FROM'],
        },
      } as ReActAgentConfig)

      const workflow = entrypoint(
        { checkpointer, name: 'tool-call-review-test' },
        async (inputs: { messages: BaseMessage[] }): Promise<AgentOutput> => {
          const result = await agentWithSafety.execute(inputs.messages)
          return {
            messages: [...inputs.messages, new AIMessage(result.content || '')],
            status: result.success ? 'continue' : 'end',
            toolFeedback: {},
            iterations: 1,
            threadId,
            configurable: {
              thread_id: threadId,
              checkpoint_ns: 'tool-call-review-test',
            },
          }
        }
      )

      // Test tool call review
      const reviewResponse = await workflow.invoke(
        {
          messages: [
            new SystemMessage('You are a helpful AI assistant.'),
            new HumanMessage('Execute this command: rm -rf /'),
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: 'tool-call-review-test',
          },
        }
      )

      expect(reviewResponse.status).toBe('continue')
      expect(reviewResponse.messages[reviewResponse.messages.length - 1].content).toBeDefined()
      expect(reviewResponse.messages[reviewResponse.messages.length - 1].content).toMatch(
        /dangerous|delete|system/i
      )
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )
})