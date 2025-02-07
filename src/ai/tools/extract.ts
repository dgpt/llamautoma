import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'
import { logger } from '@/logger'

// Initialize Tavily client
const { extract } = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
})

// Schema for extract input
const extractInputSchema = z.object({
  urls: z.array(z.string()),
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
      const response = await extract(input.urls)

      // Validate output against schema
      const result = extractOutputSchema.parse(response)

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
