/**
 * Shared test configuration
 */
export const TEST_CONFIG = {
  // Standard timeout for most tests (5 seconds)
  DEFAULT_TIMEOUT: 5000,

  // Shorter timeout for quick unit tests (1 second)
  UNIT_TEST_TIMEOUT: 1000,

  // Longer timeout for integration tests (10 seconds)
  INTEGRATION_TEST_TIMEOUT: 10000,

  // Very short timeout for testing timeout behavior (50ms)
  TIMEOUT_TEST_DURATION: 50,

  // User interaction timeouts
  USER_INTERACTION: {
    // Standard timeout for user interaction in tests (1 second)
    DEFAULT: 1000,
    // Short timeout for testing timeout behavior (50ms)
    SHORT: 50,
    // Long timeout for complex interactions (5 seconds)
    LONG: 5000,
  },
} as const
