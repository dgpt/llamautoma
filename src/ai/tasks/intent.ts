import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
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
    const prompt = `You are an AI intent classifier integrated into a code editing assistant.
    Your task is to analyze the conversation history and determine the intent of the user's latest message.
    You must classify the intent as either "code" or "chat".
    Example Outputs:
    {
      "type": "code",
      "explanation": "<your step-by-step reasoning for why you chose 'code'>",
      "messageReferenced": "<the user's message you based your decision on>"
    }
    {
      "type": "chat",
      "explanation": "<your step-by-step reasoning for why you chose 'chat'>",
      "messageReferenced": "<the user's EXACT message you based your decision on>"
    }
    YOU MUST utilize your explanation to determine the correct "type".

Conversation History:
${input.messages
  .map(message =>
    message instanceof HumanMessage ? `Human: ${message.content}` : `Assistant: ${message.content}`
  )
  .join('\n')}

HOW TO DETERMINE CODE:
  - ALWAYS classify as "code" if ANY of these are true:
    1. The message requests code generation (e.g. "Create", "Write", "Generate", "Build", "Make")
    2. The message requests code modification (e.g. "Update", "Change", "Fix", "Modify")
    3. The message requests debugging (e.g. "Debug", "Fix error", "Why isn't this working")
    4. The message requests file operations (e.g. "Create file", "Delete file", "Move file")
    5. The message requests running commands (e.g. "Run tests", "Start server")
    6. The message asks about implementation (e.g. "How do I implement", "How to create")
    7. The message is a follow-up to a code request
    8. The message mentions specific files, paths, or code elements
    9. The message implies code changes are needed, even indirectly

HOW TO DETERMINE CHAT:
  - ONLY classify as "chat" if ALL of these are true:
    1. The message is PURELY about explaining concepts (e.g. "What is TypeScript?")
    2. The message is PURELY about general discussion (e.g. "Tell me about React", "What is the difference between <x> and <y>?")
    3. The message can be answered without ANY code generation or modification
    4. The message does not mention ANY specific files or code elements
    5. The message is not a follow-up to a code request
    6. The message is technical but does not imply code changes are needed at this time.
    7. The message can be answered by an LLM without any code generation or modification.

EXPLANATION REQUIREMENTS:
  - Provide a concise, step-by-step explanation of your decision
  - List the key indicators that led to your choice
  - Reference specific parts of the message that influenced your decision

OUTPUT REQUIREMENTS:
  - Do not generate any additional text or answer the user's query—only classify the intent
  - Your output must be a valid JSON object exactly in the following format:
{
  "type": "code" or "chat",
  "explanation": "Step-by-step reasoning: ...",
  "messageReferenced": "The user's message you based your decision on"
}

IMPORTANT: messageReferenced must be the EXACT text of the user's message you based your decision on. DO NOT SUMMARIZE THE MESSAGE.

Remember: Your output should include only the JSON object and nothing else.
`

    try {
      const intent = createStructuredLLM(IntentSchema, TaskType.Intent, config?.config)
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
