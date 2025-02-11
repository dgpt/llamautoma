import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { BaseMessage } from '@langchain/core/messages'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { TaskType } from '@/types'
import type { Config } from '@/types'
import { logger } from '@/logger'

// Schema for feedback
export const feedbackSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  iterations: z.number().optional(),
})

export type Feedback = z.infer<typeof feedbackSchema>

/**
 * Create a ChatOllama instance for a specific task type
 */
export function createLLM(taskType: TaskType, config: Config) {
  if (!config) {
    throw new Error('Config is required for LLM creation')
  }

  // Select the appropriate model based on task type
  const model = (() => {
    switch (taskType) {
      case TaskType.Code:
        return config.models.coder
      case TaskType.Intent:
        return config.models.intent
      case TaskType.Plan:
        return config.models.planner
      case TaskType.Review:
        return config.models.reviewer
      case TaskType.Summarize:
        return config.models.summarizer
      default:
        logger.warn(`Unknown task type ${taskType}, defaulting to coder model`)
        return config.models.coder
    }
  })()

  // Validate model configuration
  if (!model) {
    throw new Error(`No model configured for task type ${taskType}`)
  }

  // Create ChatOllama instance with validated config
  return new ChatOllama({
    model,
    baseUrl: config.server.host,
    temperature: config.llm?.temperature ?? 0.7,
    topP: config.llm?.topP ?? 0.9,
    topK: config.llm?.topK ?? 40,
    numPredict: config.llm?.numPredict ?? 128,
  })
}

/**
 * Create a structured LLM that outputs according to a schema
 */
export function createStructuredLLM<T>(schema: z.ZodType<T>, taskType: TaskType, config: Config) {
  if (!config) {
    throw new Error('Config is required for structured LLM creation')
  }

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
    createLLM(taskType, config),
    parser,
  ])

  return chain
}
