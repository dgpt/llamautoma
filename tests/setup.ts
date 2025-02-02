import { afterEach, beforeEach, afterAll, beforeAll } from 'bun:test'
import { logger } from '../src/utils/logger'
import { Server } from '../src/server'

// Track active model invocations
const activeInvocations = new Set<string>()
let isTestEnvironment = false

// Global beforeAll hook for test suite
beforeAll(() => {
  logger.trace('Initializing test suite')
  process.env.NODE_ENV = 'test'
  isTestEnvironment = true
  activeInvocations.clear()
})

// Global afterAll hook for test suite
afterAll(async () => {
  logger.trace('Cleaning up test suite')
  if (activeInvocations.size > 0) {
    logger.warn(`Force cleaning up ${activeInvocations.size} remaining invocations`)
    await modelInvocationManager.forceCleanup()
  }
  // Unref the server instance
  Server.unref()
  process.env.NODE_ENV = 'development'
  isTestEnvironment = false
})

// Global beforeEach hook
beforeEach(() => {
  activeInvocations.clear()
  logger.trace('Test initialized')
})

// Global afterEach hook
afterEach(async () => {
  if (activeInvocations.size > 0) {
    logger.warn(`Cleaning up ${activeInvocations.size} active invocations`)
    await modelInvocationManager.forceCleanup()
  }
  logger.trace('Test cleaned up')
})

// Export utilities for tests to use
export const modelInvocationManager = {
  /**
   * Wait until we can start a new invocation
   * @param threadId The thread ID of the invocation
   */
  async waitForTurn(threadId: string): Promise<void> {
    if (!isTestEnvironment) return

    let attempts = 0
    const maxAttempts = 10
    const delayMs = 100

    while (activeInvocations.size > 0 && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      attempts++
    }

    if (attempts >= maxAttempts) {
      logger.warn(`Timed out waiting for turn on thread ${threadId}`)
      await this.forceCleanup()
    }
  },

  /**
   * Register a new model invocation
   * @param threadId The thread ID of the invocation
   */
  async startInvocation(threadId: string): Promise<void> {
    if (!isTestEnvironment) return
    await this.waitForTurn(threadId)
    activeInvocations.add(threadId)
    logger.trace(`Started invocation ${threadId}`)
  },

  /**
   * Complete a model invocation
   * @param threadId The thread ID of the invocation
   */
  completeInvocation(threadId: string): void {
    if (!isTestEnvironment) return
    if (activeInvocations.has(threadId)) {
      activeInvocations.delete(threadId)
      logger.trace(`Completed invocation ${threadId}`)
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
    activeInvocations.clear()
    logger.warn('Force cleaned up all invocations')
  },

  /**
   * Wait for all active invocations to complete
   */
  async waitForInvocations(): Promise<void> {
    if (!isTestEnvironment || activeInvocations.size === 0) return

    const invocations = Array.from(activeInvocations)
    logger.trace(`Waiting for invocations: ${invocations.join(', ')}`)

    let attempts = 0
    const maxAttempts = 10
    const delayMs = 100

    while (activeInvocations.size > 0 && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      attempts++
    }

    if (attempts >= maxAttempts) {
      logger.warn('Timed out waiting for invocations to complete')
      await this.forceCleanup()
    }
  }
}