import { afterEach, beforeEach, mock } from 'bun:test'
import { mockFileSystem } from './unit/utils'

// Store original Response for restoration
const originalResponse = globalThis.Response

// Reset mocks and cleanup before each test
beforeEach(() => {
  mockFileSystem.clear()
  // Reset Response to original
  globalThis.Response = originalResponse
})

// Clean up after each test
afterEach(() => {
  mockFileSystem.clear()
  // Clear all mocks
  mock.restore()
  // Reset Response to original
  globalThis.Response = originalResponse
})
