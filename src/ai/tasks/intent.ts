import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { createStructuredLLM } from '@/ai/llm'
import { logger } from '@/logger'
import { task } from '@langchain/langgraph'
import { RunnableConfig, TaskType } from '@/types'

// Schema for intent classification
const IntentSchema = z.object({
  type: z
    .enum(['code', 'chat'])
    .describe(
      'The type of response needed: code for code generation, chat for natural conversation'
    ),
  messageReferenced: z
    .string()
    .describe("The user's message you are referencing to make your determination"),
  explanation: z.string().describe('Brief explanation of why you chose this classification'),
})

export type Intent = z.infer<typeof IntentSchema>

const intent = createStructuredLLM<Intent>(IntentSchema, TaskType.Intent)

/**
 * Determines the intent of the user's query
 * @param messages The conversation history
 * @returns Classification of the intent as either code generation or natural conversation
 * @throws Error if no user message is found
 */
export const intentTask = task(
  'intent',
  async (
    input: {
      messages: BaseMessage[]
    },
    config?: RunnableConfig
  ): Promise<Intent> => {
    const prompt = `You are an AI intent classifier integrated into a code editing assistant. Your sole task is to analyze the entire conversation history along with the user’s latest message and determine whether the user’s intent is to write code (label: "code") or to receive a simple, non-code response (label: "chat").

Guidelines:
1. If the message explicitly or implicitly requests help with code (e.g., debugging, writing, or modifying code) or mentions code-related keywords (like function, variable, snippet, etc.), classify as "code".
2. If the message is general or unrelated to code tasks, classify as "chat".
3. In ambiguous cases where code-related intent is not clear, default to "code" if any code-relevant context is present.
4. Provide a concise, step-by-step explanation of your decision. Use a chain-of-thought style: list the key indicators that led to your choice.
5. Do not generate any additional text or answer the user's query—only classify the intent.
6. Your output must be a valid JSON object exactly in the following format:
{
  "type": "code" or "chat",
  "explanation": "Step-by-step reasoning: ...",
  "messageReferenced": "The exact text of the user's message you based your decision on"
}

Remember: Your output should include only the JSON object and nothing else.
`

    try {
      const result = await intent.invoke([...input.messages, new SystemMessage(prompt)], config)
      logger.debug(result)
      return result
    } catch (error) {
      logger.error({ error }, 'Error in intent task')
      // Default to code for implementation-related errors
      return {
        type: 'code',
        explanation: 'Defaulting to code due to error in classification',
        messageReferenced: 'No message referenced',
      }
    }
  }
)
