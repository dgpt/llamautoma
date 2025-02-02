import { afterEach, beforeEach, afterAll, beforeAll } from 'bun:test'
import { logger } from '../src/utils/logger'

// Track active model invocations and their completion promises
const activeInvocations = new Map<string, {
  promise: Promise<void>,
  resolve: () => void
}>()
let isTestEnvironment = false

// Global beforeAll hook for test suite
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  isTestEnvironment = true
  activeInvocations.clear()
})

// Global afterAll hook for test suite
afterAll(async () => {
  if (activeInvocations.size > 0) {
    await modelInvocationManager.forceCleanup()
  }
  process.env.NODE_ENV = 'development'
  isTestEnvironment = false
})

// Global beforeEach hook
beforeEach(() => {
  activeInvocations.clear()
})

// Global afterEach hook
afterEach(async () => {
  if (activeInvocations.size > 0) {
    await modelInvocationManager.forceCleanup()
  }
})

// Export utilities for tests to use
export const modelInvocationManager = {
  /**
   * Wait until we can start a new invocation
   * @param threadId The thread ID of the invocation
   */
  async waitForTurn(threadId: string): Promise<void> {
    if (!isTestEnvironment) return

    // Wait for any active invocations to complete
    if (activeInvocations.size > 0) {
      await Promise.all([...activeInvocations.values()].map(inv => inv.promise))
    }
  },

  /**
   * Register a new model invocation
   * @param threadId The thread ID of the invocation
   */
  async startInvocation(threadId: string): Promise<void> {
    if (!isTestEnvironment) return
    await this.waitForTurn(threadId)

    // Create a new promise for this invocation
    let resolveInvocation: () => void
    const promise = new Promise<void>(resolve => {
      resolveInvocation = resolve
    })

    activeInvocations.set(threadId, {
      promise,
      resolve: resolveInvocation!
    })
  },

  /**
   * Complete a model invocation
   * @param threadId The thread ID of the invocation
   */
  completeInvocation(threadId: string): void {
    if (!isTestEnvironment) return
    const invocation = activeInvocations.get(threadId)
    if (invocation) {
      invocation.resolve()
      activeInvocations.delete(threadId)
    }
  },

  /**
   * Check if there are any active invocations
   */
  hasActiveInvocations(): boolean {
    return activeInvocations.size > 0
  },

  /**
   * Force cleanup of all invocations
   */
  async forceCleanup(): Promise<void> {
    if (!isTestEnvironment || activeInvocations.size === 0) return

    // Resolve all pending invocations
    for (const invocation of activeInvocations.values()) {
      invocation.resolve()
    }
    activeInvocations.clear()
  },

  /**
   * Wait for all active invocations to complete
   */
  async waitForInvocations(): Promise<void> {
    if (!isTestEnvironment || activeInvocations.size === 0) return

    // Wait for all active invocations to complete
    await Promise.all([...activeInvocations.values()].map(inv => inv.promise))
  }
}