import { mock } from 'bun:test'

// Mock search results
const mockSearchResults = {
  results: [
    {
      title: 'TypeScript Tutorial',
      url: 'https://example.com/typescript',
      content: 'Learn TypeScript basics and advanced concepts',
      score: 0.95,
      source: 'example.com',
    },
  ],
  query: '',
  searchDepth: 'basic' as const,
}

// Mock extract results
const mockExtractResults = {
  results: [
    {
      url: 'https://example.com',
      rawContent: 'Example page content',
    },
  ],
  failedResults: [],
  responseTime: 1234,
}

// Mock functions
const mockSearch = mock(async (query: string, options?: { searchDepth?: 'basic' | 'advanced' }) => {
  return {
    ...mockSearchResults,
    query,
    searchDepth: options?.searchDepth || 'basic',
  }
})

const mockExtract = mock(async (urls: string[]) => {
  return {
    ...mockExtractResults,
    results: urls.map(url => ({
      url,
      rawContent: `Mock content for ${url}`,
    })),
    failedResults: urls
      .filter(url => !url.startsWith('http'))
      .map(url => ({
        url,
        error: 'Invalid URL',
      })),
  }
})

// Create mock tavily client
export const mockTavily = () => ({
  search: mockSearch,
  extract: mockExtract,
})

// Helper to get either real or mock tavily based on env
export const getTavily = () => {
  if (process.env.TEST_TAVILY) {
    // Use real tavily
    return require('@tavily/core').tavily({
      apiKey: process.env.TAVILY_API_KEY || '',
    })
  }
  // Use mock
  return mockTavily()
}

// Export mocks for test assertions
export { mockSearch, mockExtract }
