import { BaseMessage, HumanMessage, SystemMessage, MessageContent } from '@langchain/core/messages'
import { z } from 'zod'
import { createStructuredLLM } from '@/ai/llm'
import { logger } from '@/logger'
import { task } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'

// Schema for intent classification
const IntentSchema = z.object({
  type: z
    .enum(['code', 'chat'])
    .describe(
      'The type of response needed: code for code generation, chat for natural conversation'
    ),
  explanation: z.string().describe('Brief explanation of why you chose this classification'),
})

export type Intent = z.infer<typeof IntentSchema>

const intent = createStructuredLLM<Intent>(IntentSchema)

/**
 * Converts MessageContent to a string representation
 */
function getMessageString(content: MessageContent): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map(item => {
      if (typeof item === 'string') return item
      if (item.type === 'text') return item.text
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

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
    // Find the last user message
    const lastUserMessage = [...input.messages].reverse().find(msg => msg instanceof HumanMessage)
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation history')
    }

    const messageString = getMessageString(lastUserMessage.content)

    const prompt = `You are an assistant that must analyze a message and determine its intent.

Your task is to classify the message into one of two categories:
1. "chat" - for natural conversation and questions
2. "code" - for code-related requests and actions

You MUST respond with a JSON object containing:
- "type": either "chat" or "code"
- "explanation": a brief explanation of your classification

Examples of valid responses:

For a chat message:
{
  "type": "chat",
  "explanation": "This is a general question about programming concepts that doesn't require writing code."
}

For a code request:
{
  "type": "code",
  "explanation": "The user is asking for a specific code implementation of a feature."
}

Guidelines for classification:

"chat" type messages:
- General questions about concepts
- Questions about the codebase or workspace
- Requests for explanations
- Non-coding tasks
- Information seeking queries

"code" type messages:
- Requests to write or modify code
- Bug fixes
- Test writing
- File operations
- Implementation requests
- Debugging help

Remember:
1. ONLY output a single JSON object
2. The JSON MUST have both "type" and "explanation" fields
3. "type" MUST be either "chat" or "code"
4. "explanation" MUST be a string explaining your choice
5. NO text outside the JSON object

Now analyze this message: "${messageString}"`

    const result = await intent.invoke([new SystemMessage(prompt), new HumanMessage(messageString)])
    logger.debug(result)
    return result
  }
)
