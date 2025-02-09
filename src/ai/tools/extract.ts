import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'
import { logger } from '@/logger'

// Initialize Tavily client
const { extract } =
  process.env.NODE_ENV === 'test'
    ? require('@/tests/unit/mocks/tavily').getTavily()
    : tavily({
        apiKey: process.env.TAVILY_API_KEY || '',
      })

// URL validation schema
const urlSchema = z.string().url('Invalid URL format')

// Schema for extract input
const extractInputSchema = z.object({
  urls: z.array(urlSchema).min(1, 'URLs array cannot be empty'),
})

// Schema for extract output
const extractOutputSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      rawContent: z.string(),
    })
  ),
  failedResults: z.array(
    z.object({
      url: z.string(),
      error: z.string(),
    })
  ),
  responseTime: z.number(),
})

// Create the extract tool using LangChain's tool function
export const extractTool = tool(
  async (input: z.infer<typeof extractInputSchema>) => {
    try {
      // Validate URLs array is not empty
      if (input.urls.length === 0) {
        throw new Error('URLs array cannot be empty')
      }

      // Track failed extractions
      const results: { url: string; rawContent: string }[] = []
      const failedResults: { url: string; error: string }[] = []

      // Process each URL
      for (const url of input.urls) {
        try {
          const response = await extract([url])
          if (response.results && response.results.length > 0) {
            results.push(...response.results)
          } else {
            failedResults.push({ url, error: 'No content extracted' })
          }
        } catch (error) {
          failedResults.push({
            url,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Construct response
      const result = extractOutputSchema.parse({
        results,
        failedResults,
        responseTime: Date.now(),
      })

      // Return formatted result with plain text content for LLM readability
      return JSON.stringify(result, null, 2)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error }, 'Extract tool error')
      throw new Error(`Failed to extract content: ${message}`)
    }
  },
  {
    name: 'extract',
    description: 'Extract readable content from web pages using Tavily.',
    schema: extractInputSchema,
  }
)
