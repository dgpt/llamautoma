import { task } from '@langchain/langgraph'
import { z } from 'zod'
import { TavilyClient, TavilySearchResult, TavilyExtractResponse } from '@tavily/core'

// Initialize Tavily client
const tavily = new TavilyClient({
  apiKey: process.env.TAVILY_API_KEY || '',
})

// Schema for search output
export const searchSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      score: z.number(),
      source: z.string(),
    })
  ),
  query: z.string(),
  searchDepth: z.enum(['basic', 'advanced']).optional(),
})

// Schema for content extraction output
export const extractionSchema = z.object({
  url: z.string(),
  content: z.string(),
  metadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      author: z.string().optional(),
      publishedDate: z.string().optional(),
    })
    .optional(),
})

// Task to perform web search
export const performSearch = task(
  'performSearch',
  async (params: { query: string; searchDepth?: 'basic' | 'advanced' }) => {
    const { query, searchDepth = 'basic' } = params

    const response = await tavily.search({
      query,
      searchDepth,
      includeRaw: true,
      maxResults: 5,
    })

    return {
      results: response.results.map((result: TavilySearchResult) => ({
        title: result.title,
        url: result.url,
        content: result.content,
        score: result.score,
        source: result.source,
      })),
      query,
      searchDepth,
    }
  }
)

// Task to extract content from URL
export const extractContent = task('extractContent', async (url: string) => {
  const response = await tavily.extractContent({
    url,
    include_raw: true,
    include_metadata: true,
  })

  return {
    url,
    content: response.content,
    metadata: {
      title: response.metadata?.title,
      description: response.metadata?.description,
      author: response.metadata?.author,
      publishedDate: response.metadata?.published_date,
    },
  }
})
