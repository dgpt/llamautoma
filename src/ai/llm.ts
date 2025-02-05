import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_AGENT_CONFIG } from '@/config'

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
  return llm.withStructuredOutput(schema)
}
