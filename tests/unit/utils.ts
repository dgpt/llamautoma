import { Mock, mock, afterEach, expect } from 'bun:test'
import { ChatOllama } from '@langchain/ollama'
import { MemorySaver, entrypoint } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { compressAndEncodeMessage } from '@/lib/compression'
import type { ServerMessage } from '@/stream'

// Constants
export const TEST_TIMEOUT = 60000 // 60 seconds for real model responses
export const TEST_MODEL = 'qwen2.5-coder:1.5b' // Smaller, faster model for tests
export const TEST_HOST = 'http://localhost:11434'

// Test context type
export interface TestContext {
  threadId: string
  memorySaver: MemorySaver
}

// Create test context
export const createTestContext = (): TestContext => ({
  threadId: 'test',
  memorySaver: new MemorySaver(),
})

// Create test model
export const createTestModel = (): ChatOllama =>
  new ChatOllama({
    model: TEST_MODEL,
    baseUrl: TEST_HOST,
  })

/**
 * Mock a client response with compressed message
 */
export const mockClientResponse = (fn: Mock<any>, data: Record<string, unknown>): void => {
  const message: ServerMessage = {
    type: 'edit',
    content: JSON.stringify(data),
    timestamp: Date.now(),
  }
  const compressed = compressAndEncodeMessage(message)

  mockStream(
    fn,
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${compressed}\n\n`))
        controller.close()
      },
    })
  )
}

/**
 * Mock a stream response
 */
export const mockStream = (fn: Mock<any>, stream: ReadableStream): Mock<any> => {
  fn.mockImplementation(() => new Response(stream))
  globalThis.Response = fn as unknown as typeof Response
  return fn
}

/**
 * Reset test mode
 */
export const resetTestMode = (): void => {
  mock.restore()
}

// Clean up after each test
afterEach(() => {
  resetTestMode()
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

// Create test LLM
export const testLLM = new ChatOllama({
  model: TEST_MODEL,
  baseUrl: TEST_HOST,
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
  const ctx = createTestContext()
  const workflow = entrypoint(
    {
      name: 'test',
      checkpointer: ctx.memorySaver,
    },
    async () => {
      const boundTask = task.bind({ config: testConfig })
      return await boundTask({ messages: input })
    }
  )
  const result = await workflow.invoke(null, {
    configurable: {
      thread_id: ctx.threadId,
      checkpoint_ns: 'test',
    },
  })
  return result as T
}
