import { BaseMessage, HumanMessage, SystemMessage, MessageContent } from '@langchain/core/messages'
import { z } from 'zod'
import { createStructuredLLM } from '@/ai/llm'
import { logger } from '@/logger'

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
export async function intentTask({ messages }: { messages: BaseMessage[] }): Promise<Intent> {
  // Find the last user message
  const lastUserMessage = [...messages].reverse().find(msg => msg instanceof HumanMessage)
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation history')
  }

  const messageString = getMessageString(lastUserMessage.content)

  const prompt = `You are an assistant that must analyze a message and determine its intent.

To determine "chat":
- the message does not require you to write code
- the message is asking a question
- the message doesn't provide a specific action
- the message is asking you to do something that does not require you to write code
- the message is implying that they want you to chat with them
- the message is a question about the codebase, workspace, directory, file, etc.
  - in this case, you can use the file tool to answer the question
- the message is something you can answer by searching the internet
  - use the search tool to find a website
  - use the extract tool to extract information from a website

if any of the above are true, you MUST respond with:
{
  "type": "chat",
  "explanation": <a brief explanation of your thought process>
}

---------------------------------

To determine "code":
- the message provides a specific action
- the message is implying or asking you to write code
- the message is asking you to fix a bug
- the message is asking you to write a test
- the message is asking you to implement a feature

if any of the above are true, you MUST respond with:
{
  "type": "code",
  "explanation": <a brief explanation of your thought process>
}

---------------------------------

You MUST consider all of these factors when determining the intent.
You MUST provide a well thought out explanation for your choice.
You MUST consider all possible factors when determining the intent.

MOST IMPORTANT:
You MUST respond in JSON format with the following structure:
{
  "type": <"chat" or "code">,
  "explanation": <a brief explanation of your thought process>
}`

  const result = await intent.invoke([new SystemMessage(prompt), new HumanMessage(messageString)])
  logger.debug(result)
  return result
}
