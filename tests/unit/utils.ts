import { expect } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { RunnableConfig } from '@langchain/core/runnables'
import { DEFAULT_AGENT_CONFIG } from '../../src/config'

// Constants
export const TEST_TIMEOUT = 60000 // 60 seconds for real model responses
export const TEST_MODEL = 'qwen2.5-coder:1.5b' // Smaller, faster model for tests
export const TEST_BASE_URL = 'http://localhost:11434'

// Test context type
export interface TestContext {
  memorySaver: MemorySaver
  chatModel: ChatOllama
  threadId: string
  config: RunnableConfig
}

// Create test LLM
export const testLLM = new ChatOllama({
  model: TEST_MODEL,
  baseUrl: TEST_BASE_URL,
})

// Create test config
export const testConfig: RunnableConfig = {
  configurable: {
    thread_id: 'test',
    checkpoint_ns: 'test',
  },
  tags: ['test'],
  metadata: {
    test: true,
  },
}

// Helper to create clean test context
export const createTestContext = (): TestContext => ({
  memorySaver: new MemorySaver(),
  chatModel: testLLM,
  threadId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  config: testConfig,
})

// Helper to wait for response with timeout
export const waitForResponse = async <T>(promise: Promise<T>): Promise<T> => {
  const result = await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Response timeout after ${TEST_TIMEOUT}ms`)), TEST_TIMEOUT)
    ),
  ])
  return result as T
}

// Helper to collect stream output into array
export const collectStreamOutput = async <T>(stream: AsyncGenerator<T>): Promise<T[]> => {
  const chunks: T[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
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
}

// Helper to run tasks with test config
export async function runWithTestConfig<T>(task: any, input: any): Promise<T> {
  const fn = task.bind(null, input)
  return await fn()
}