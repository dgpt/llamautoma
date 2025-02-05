import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_AGENT_CONFIG } from '@/config'
import { StructuredOutputParser } from '@langchain/core/output_parsers'

// Schema for feedback
export const feedbackSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  iterations: z.number().optional(),
})

export type Feedback = z.infer<typeof feedbackSchema>

// Create base LLM
export const llm = new ChatOllama({
  model: DEFAULT_AGENT_CONFIG.modelName,
  baseUrl: DEFAULT_AGENT_CONFIG.host,
})

// Create LLM with structured output
export function createStructuredLLM<T>(schema: z.ZodType<T>) {
  const parser = StructuredOutputParser.fromZodSchema(schema)
  return llm.pipe(parser)
}
