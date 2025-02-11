import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_CONFIG, TEST_CONFIG } from '@/config'
import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { BaseMessage } from '@langchain/core/messages'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { TaskType } from '@/types'

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
export function createLLM(taskType: TaskType, config = DEFAULT_CONFIG) {
  const modelName = process.env.NODE_ENV === 'test' ? TEST_CONFIG.models : config.models

  // Select the appropriate model based on task type
  let model: string
  switch (taskType) {
    case TaskType.Code:
      model = modelName.coder
      break
    case TaskType.Intent:
      model = modelName.intent
      break
    case TaskType.Plan:
      model = modelName.planner
      break
    case TaskType.Review:
      model = modelName.reviewer
      break
    case TaskType.Summarize:
      model = modelName.summarizer
      break
    default:
      model = modelName.coder
  }

  return new ChatOllama({
    model,
    baseUrl: config.server.host,
  })
}

/**
 * Create a structured LLM that outputs according to a schema
 */
export function createStructuredLLM<T>(schema: z.ZodType<T>, taskType: TaskType = TaskType.Code) {
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
    createLLM(taskType),
    parser,
  ])

  return chain
}

// Export for testing
export const testLLM = createLLM(TaskType.Code, TEST_CONFIG)