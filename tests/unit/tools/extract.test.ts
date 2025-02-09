import { expect, test, describe, mock, beforeEach } from 'bun:test'
import { extractTool } from '@/ai/tools/extract'
import { mockExtract, getTavily } from '../mocks/tavily'

// Mock the tavily import in the tool
mock.module('@tavily/core', () => ({
  tavily: () => getTavily(),
}))

interface ExtractResult {
  url: string
  rawContent: string
}

describe('Extract Tool', () => {
  beforeEach(() => {
    if (!process.env.TEST_TAVILY) {
      mockExtract.mockClear()
    }
  })

  test('should extract content from single URL', async () => {
    const result = await extractTool.invoke({
      urls: ['https://example.com'],
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('results')
    expect(parsed).toHaveProperty('failedResults')
    expect(parsed).toHaveProperty('responseTime')
    expect(Array.isArray(parsed.results)).toBe(true)

    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).toHaveBeenCalledTimes(1)
      expect(mockExtract).toHaveBeenCalledWith(['https://example.com'])
    }
  })

  test('should extract content from multiple URLs', async () => {
    const urls = ['https://example.com', 'https://example.org']
    const result = await extractTool.invoke({ urls })
    const parsed = JSON.parse(result)
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.results.length).toBeLessThanOrEqual(2)
    parsed.results.forEach((result: ExtractResult) => {
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('rawContent')
    })
  })

  test('should handle failed extractions', async () => {
    // Mock extract to simulate failure
    if (!process.env.TEST_TAVILY) {
      mockExtract.mockImplementationOnce(() =>
        Promise.resolve({
          results: [],
          failedResults: [
            {
              url: 'https://nonexistent.example.com',
              error: 'Failed to extract content',
            },
          ],
          responseTime: Date.now(),
        })
      )
    }

    const result = await extractTool.invoke({
      urls: ['https://nonexistent.example.com'],
    })
    const parsed = JSON.parse(result)
    expect(parsed.failedResults).toBeInstanceOf(Array)
    expect(parsed.failedResults.length).toBe(1)
    expect(parsed.failedResults[0]).toHaveProperty('url')
    expect(parsed.failedResults[0]).toHaveProperty('error')
  })

  test('should handle empty URLs array', async () => {
    await expect(extractTool.invoke({ urls: [] })).rejects.toThrow(
      'Received tool input did not match expected schema'
    )
  })

  test('should handle invalid URLs', async () => {
    await expect(
      extractTool.invoke({
        urls: ['not-a-url'],
      })
    ).rejects.toThrow('Received tool input did not match expected schema')
  })

  test('should handle mixed valid and invalid URLs', async () => {
    await expect(
      extractTool.invoke({
        urls: ['https://example.com', 'not-a-url'],
      })
    ).rejects.toThrow('Received tool input did not match expected schema')
  })
})
