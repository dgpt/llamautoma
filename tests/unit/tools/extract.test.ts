import { expect, test, describe, beforeEach, mock } from 'bun:test'
import { ExtractTool } from '@/ai/tools/extract'
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
  let tool: ExtractTool

  beforeEach(() => {
    tool = new ExtractTool()
    if (!process.env.TEST_TAVILY) {
      mockExtract.mockClear()
    }
  })

  test('should extract content from single URL', async () => {
    const result = await tool.invoke({
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
    const result = await tool.invoke({ urls })
    const parsed = JSON.parse(result)
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.results.length).toBeLessThanOrEqual(2)
    parsed.results.forEach((result: ExtractResult) => {
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('rawContent')
    })

    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).toHaveBeenCalledTimes(1)
      expect(mockExtract).toHaveBeenCalledWith(urls)
    }
  })

  test('should handle failed extractions', async () => {
    const result = await tool.invoke({
      urls: ['https://nonexistent.example.com'],
    })
    const parsed = JSON.parse(result)
    expect(parsed.failedResults).toBeInstanceOf(Array)
    expect(parsed.failedResults.length).toBeGreaterThan(0)
    expect(parsed.failedResults[0]).toHaveProperty('url')
    expect(parsed.failedResults[0]).toHaveProperty('error')

    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).toHaveBeenCalledTimes(1)
      expect(mockExtract).toHaveBeenCalledWith(['https://nonexistent.example.com'])
    }
  })

  test('should handle empty URLs array', async () => {
    await expect(tool.invoke({ urls: [] })).rejects.toThrow()
    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).not.toHaveBeenCalled()
    }
  })

  test('should handle invalid URLs', async () => {
    const result = await tool.invoke({
      urls: ['not-a-url'],
    })
    const parsed = JSON.parse(result)
    expect(parsed.failedResults).toBeInstanceOf(Array)
    expect(parsed.failedResults.length).toBe(1)
    expect(parsed.failedResults[0].error).toBeTruthy()

    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).toHaveBeenCalledTimes(1)
      expect(mockExtract).toHaveBeenCalledWith(['not-a-url'])
    }
  })

  test('should handle mixed valid and invalid URLs', async () => {
    const urls = ['https://example.com', 'not-a-url']
    const result = await tool.invoke({ urls })
    const parsed = JSON.parse(result)
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.failedResults).toBeInstanceOf(Array)
    expect(parsed.results.length + parsed.failedResults.length).toBe(2)

    if (!process.env.TEST_TAVILY) {
      expect(mockExtract).toHaveBeenCalledTimes(1)
      expect(mockExtract).toHaveBeenCalledWith(urls)
    }
  })
})
