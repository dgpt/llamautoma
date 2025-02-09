import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { SystemMessage, BaseMessage } from '@langchain/core/messages'
import { logger } from '@/logger'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'

// Schema for feedback
export const feedbackSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  iterations: z.number().optional(),
})

export type Feedback = z.infer<typeof feedbackSchema>

// Constants
const DEFAULT_MODEL = 'qwen2.5-coder:7b'
const TEST_MODEL = 'qwen2.5-coder:1.5b'
const DEFAULT_HOST = 'http://localhost:11434'

// Create base LLM instance
export const llm = new ChatOllama({
  model: process.env.NODE_ENV === 'test' ? TEST_MODEL : DEFAULT_MODEL,
  baseUrl: DEFAULT_HOST,
})

const requirements = `
DO NOT include comments, code snippets, etc. outside of valid JSON strings.
ONLY respond with valid JSON.
ALL strings MUST be terminated properly and all special characters MUST be escaped.
Your response MUST conform to the provided JSON schema.
Your response MUST follow additional instructions supplied in the conversation context.
`

/**
 * Create a structured LLM that outputs according to a schema
 */
export function createStructuredLLM<T>(schema: z.ZodType<T>) {
  const parser = StructuredOutputParser.fromZodSchema(schema)

  const formatInstructions = parser.getFormatInstructions()

  const prompt = PromptTemplate.fromTemplate(`{format_instructions}

{input}`)

  const chain = RunnableSequence.from([
    {
      format_instructions: () => formatInstructions,
      input: (messages: BaseMessage[]) => messages.map(m => m.content).join('\n'),
    },
    prompt,
    llm,
    parser,
  ])

  return chain
}

// Export for testing
export const testLLM = new ChatOllama({
  model: TEST_MODEL,
  baseUrl: DEFAULT_HOST,
})