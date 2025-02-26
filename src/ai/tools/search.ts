import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'

// Initialize Tavily client
const { search } =
  process.env.NODE_ENV === 'test'
    ? require('@/tests/unit/mocks/tavily').getTavily()
    : tavily({
        apiKey: process.env.TAVILY_API_KEY || '',
      })

// Schema for search input
const searchInputSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  searchDepth: z.enum(['basic', 'advanced']).optional(),
})

// Schema for search output
const searchOutputSchema = z.object({
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

// Create the search tool using LangChain's tool function
export const searchTool = tool(
  async (input: z.infer<typeof searchInputSchema>) => {
    try {
      const { query, searchDepth = 'basic' } = input

      // Validate query is not empty
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const response = await search(query, {
        searchDepth,
        maxResults: 5,
      })

      // Validate output against schema
      const result = searchOutputSchema.parse({
        results: response.results,
        query,
        searchDepth,
      })

      // Return formatted result
      return JSON.stringify(result, null, 2)
    } catch (error) {
      throw new Error(`Failed to search: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
  {
    name: 'search',
    description: 'Search the web for information using Tavily',
    schema: searchInputSchema,
  }
)
