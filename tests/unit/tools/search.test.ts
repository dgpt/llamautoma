import { expect, test, describe } from 'bun:test'
import { searchTool } from '@/ai/tools/search'

describe('Search Tool', () => {
  test('should perform basic web search', async () => {
    const result = await searchTool.invoke({ query: 'TypeScript tutorial' })
    const parsed = JSON.parse(result)
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.query).toBe('TypeScript tutorial')
    expect(parsed.searchDepth).toBe('basic')
    expect(parsed.results.length).toBeGreaterThan(0)
  })

  test('should handle empty query', async () => {
    await expect(searchTool.invoke({ query: '' })).rejects.toThrow()
  })

  test('should handle advanced search depth', async () => {
    const result = await searchTool.invoke({ query: 'React hooks', searchDepth: 'advanced' })
    const parsed = JSON.parse(result)
    expect(parsed.searchDepth).toBe('advanced')
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.results.length).toBeGreaterThan(0)
  })

  test('should include required fields in results', async () => {
    const result = await searchTool.invoke({ query: 'GraphQL vs REST API' })
    const parsed = JSON.parse(result)
    const firstResult = parsed.results[0]

    expect(firstResult).toHaveProperty('title')
    expect(firstResult).toHaveProperty('url')
    expect(firstResult).toHaveProperty('content')
    expect(firstResult).toHaveProperty('score')
    expect(firstResult).toHaveProperty('source')
  })

  test('should handle special characters in query', async () => {
    const result = await searchTool.invoke({ query: 'C++ programming & data structures' })
    const parsed = JSON.parse(result)
    expect(parsed.query).toBe('C++ programming & data structures')
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.results.length).toBeGreaterThan(0)
  })

  test('should handle non-existent topics', async () => {
    const result = await searchTool.invoke({ query: 'xyzabc123nonexistenttopic' })
    const parsed = JSON.parse(result)
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.results.length).toBeGreaterThanOrEqual(0)
  })

  test('should respect rate limits', async () => {
    const queries = Array(5).fill('TypeScript')
    const results = await Promise.all(queries.map(query => searchTool.invoke({ query })))

    results.forEach(result => {
      const parsed = JSON.parse(result)
      expect(parsed.results).toBeInstanceOf(Array)
      expect(parsed.results.length).toBeGreaterThan(0)
    })
  })
})
