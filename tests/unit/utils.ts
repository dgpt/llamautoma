import { expect } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'

// Constants
export const TEST_TIMEOUT = 60000 // 60 seconds for real model responses
export const TEST_MODEL = 'qwen2.5-coder:1.5b' // Smaller, faster model for tests

// Test context type
export interface TestContext {
  memorySaver: MemorySaver
  chatModel: ChatOllama
  threadId: string
}

export interface WorkflowConfig {
  threadId?: string
  checkpointNamespace?: string
  [key: string]: any
}

// Helper to create clean test context
export const createTestContext = (): TestContext => ({
  memorySaver: new MemorySaver(),
  chatModel: new ChatOllama({
    model: TEST_MODEL,
    baseUrl: 'http://localhost:11434',
  }),
  threadId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
})

export const createWorkflowConfig = (
  context: TestContext,
  config: WorkflowConfig = {}
): RunnableConfig => {
  return {
    configurable: {
      thread_id: config.threadId || context.threadId,
      checkpoint_ns: config.checkpointNamespace || 'test',
      [Symbol.toStringTag]: 'AgentConfigurable',
      ...config,
    },
  }
}

// Helper to wait for response with timeout
export const waitForResponse = async <T>(promise: Promise<T>): Promise<T> => {
  const result = await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Response timeout')), TEST_TIMEOUT)
    ),
  ])
  return result as T
}

export const mockStreamResponse = async function* (chunks: string[]) {
  for (const chunk of chunks) {
    yield { content: chunk }
  }
}

export const collectStreamOutput = async (stream: AsyncGenerator<any>): Promise<string[]> => {
  const chunks: string[] = []
  for await (const chunk of stream) {
    chunks.push(chunk.content)
  }
  return chunks
}

// Helper to validate streaming response chunks
export const validateStreamChunks = <T extends { status: string; metadata?: Record<string, any> }>(
  chunks: T[]
): void => {
  expect(chunks.length).toBeGreaterThan(0)
  chunks.forEach(chunk => {
    expect(chunk).toHaveProperty('status')
    expect(chunk).toHaveProperty('metadata')
  })
  expect(chunks[chunks.length - 1].status).toBe('success')
}
