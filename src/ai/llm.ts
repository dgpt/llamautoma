import { z } from 'zod'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_CONFIG } from 'llamautoma-types'
import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { SystemMessage, BaseMessage } from '@langchain/core/messages'
import { logger } from '@/logger'

// Schema for feedback
export const feedbackSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  iterations: z.number().optional(),
})

export type Feedback = z.infer<typeof feedbackSchema>

// Create base LLM
export const llm = new ChatOllama({
  model: DEFAULT_CONFIG.modelName,
  baseUrl: DEFAULT_CONFIG.host,
})

const requirements = `
DO NOT include comments, code snippets, etc. outside of valid JSON strings.
ONLY respond with valid JSON.
ALL strings MUST be terminated properly and all special characters MUST be escaped.
Your response MUST conform to the provided JSON schema.
Your response MUST follow additional instructions supplied in the conversation context.
`

// Create LLM with structured output
export function createStructuredLLM<T>(schema: z.ZodType<T>) {
  const parser = StructuredOutputParser.fromZodSchema(schema)
  const formatInstructions = parser.getFormatInstructions()

  async function invoke(messages: BaseMessage[], attempt = 0): Promise<T> {
    if (attempt >= DEFAULT_CONFIG.maxIterations) {
      logger.error(
        `Max retries (${DEFAULT_CONFIG.maxIterations}) reached. Using best effort response.`
      )

      // Create a response indicating we hit max retries
      const response = JSON.stringify({
        response: `I apologize, but I was unable to generate a properly formatted response after ${attempt} attempts. Please try rephrasing your request.`,
      })

      // Parse it through the schema to ensure it matches the type T
      return parser.parse(response)
    }

    if (attempt > 0) {
      logger.debug(`Retrying... Attempt ${attempt}`)
    }

    try {
      // Add format instructions
      const withInstructions = [
        new SystemMessage(`${requirements}\n${formatInstructions}`),
        ...messages,
      ]

      // Get response from LLM
      const response = await llm.invoke(withInstructions)
      const content =
        typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

      try {
        // Try to parse the response
        const parsed = await parser.parse(content)
        return parsed
      } catch (err) {
        logger.debug('Parsing failed!')
        // Log the actual error for debugging
        const zodError = err instanceof z.ZodError ? err : null
        const errorDetails = zodError
          ? zodError.issues.map(e => `- ${e.message} (at ${e.path.join('.')})`).join('\n')
          : err instanceof Error
            ? err.message
            : String(err)
        logger.debug(`Parse error details: ${errorDetails}`)

        // Create error feedback without exposing error details to model
        const errorMessage = new SystemMessage(
          `Your last response was not properly formatted. Please try again, ensuring you:
1. ONLY output a single, valid JSON object
2. Include NO text outside the JSON object
3. Properly escape all strings
4. Follow the exact schema structure provided
5. Maintain focus on the original request

${requirements}
${formatInstructions}`
        )

        // Retry with error feedback
        return invoke([...messages, errorMessage], attempt + 1)
      }
    } catch (err) {
      logger.error('LLM invocation failed!', err)

      // Create error feedback without exposing error details
      const errorMessage = new SystemMessage(
        `Your last response was not valid. Please try again, ensuring you:
1. ONLY output a single, valid JSON object
2. Include NO text outside the JSON object
3. Properly escape all strings
4. Follow the exact schema structure provided
5. Maintain focus on the original request

${requirements}
${formatInstructions}`
      )

      // Retry with error feedback
      return invoke([...messages, errorMessage], attempt + 1)
    }
  }

  return { invoke }
}