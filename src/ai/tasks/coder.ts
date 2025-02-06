import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { GeneratedCodeSchema } from 'llamautoma-types'
import type { Plan, Review, GeneratedCode } from 'llamautoma-types'
import { getMessageString } from './lib'
import { logger } from '@/logger'

// Create coder with structured output
const coder = createStructuredLLM<GeneratedCode>(GeneratedCodeSchema)

// Create the coder task
export const coderTask = task(
  'coder',
  async ({
    messages,
    plan,
    review,
  }: {
    messages: BaseMessage[]
    plan: Plan
    review?: Review
  }): Promise<GeneratedCode> => {
    // Combine messages into context
    const context = messages.map(msg => getMessageString(msg)).join('\n')

    logger.debug(`Coder invoked with plan: ${JSON.stringify(plan)}`)
    if (review) {
      logger.debug(`Previous review: ${JSON.stringify(review)}`)
    }

    const prompt = `You are a code generator. Your job is to generate complete, runnable code that EXACTLY fulfills the user's requirements.

${review ? `Previous review feedback: ${review.feedback}\n${review.suggestions?.map(s => `- ${s.step}: ${s.action}`).join('\n')}\n` : ''}

Conversation Context:
${context}

Plan to Implement:
${JSON.stringify(plan, null, 2)}

Requirements:
1. Generate COMPLETE, runnable code files
2. Include ALL necessary imports and dependencies
3. Follow the language's best practices and conventions
4. Add descriptive comments and documentation
5. Implement proper error handling
6. Use appropriate type system for the language
7. Include necessary configuration files
8. List ALL required dependencies

Response Format:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "complete file content",
      "type": "create|modify|delete",
      "description": "what this file does"
    }
  ],
  "dependencies": [
    "package-name@version",
    "another-package@^1.0.0"
  ]
}`

    // Generate code using structured LLM
    const result = await coder.invoke([new HumanMessage(prompt)])
    logger.debug(`Coder response: ${JSON.stringify(result)}`)

    return {
      files: result.files,
      dependencies: result.dependencies || [],
    }
  }
)
