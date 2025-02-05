import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'

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

export class ExtractTool extends StructuredTool {
  name = 'extract'
  description = 'Extract content from web pages using Tavily'
  schema = extractInputSchema

  async _call(input: z.infer<typeof extractInputSchema>): Promise<string> {
    try {
      const response = await extract(input.urls)

      // Validate output against schema
      const result = extractOutputSchema.parse(response)

      // Return formatted result
      return JSON.stringify(result, null, 2)
    } catch (error) {
      throw new Error(
        `Failed to extract content: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
