import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'

// Initialize Tavily client
const { search } = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
})

// Schema for search input
const searchInputSchema = z.object({
  query: z.string(),
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

export class SearchTool extends StructuredTool {
  name = 'search'
  description = 'Search the web for information using Tavily'
  schema = searchInputSchema

  async _call(input: z.infer<typeof searchInputSchema>): Promise<string> {
    try {
      const { query, searchDepth = 'basic' } = input

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
  }
}
