import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { GeneratedCodeSchema } from 'llamautoma-types'
import type { Feedback, Plan, GeneratedCode } from 'llamautoma-types'
import { getMessageString } from './lib'

// Create coder with structured output
const coder = createStructuredLLM<GeneratedCode>(GeneratedCodeSchema)

// Create the coder task
export const coderTask = task(
  'coder',
  async ({
    messages,
    plan,
    feedback,
  }: {
    messages: BaseMessage[]
    plan: Plan
    feedback?: Feedback
  }): Promise<GeneratedCode> => {
    // Combine messages into context
    const context = messages.map(msg => getMessageString(msg)).join('\n')

    // Generate code using structured LLM
    const code = await coder.invoke(
      `Generate code according to the following plan and requirements:
${feedback ? `\nPrevious attempt feedback: ${feedback.feedback}` : ''}

Conversation Context:
${context}

Plan:
${JSON.stringify(plan, null, 2)}

Requirements:
1. Generate complete, runnable code files
2. Include all necessary imports and dependencies
3. Follow best practices for each language
4. Add helpful comments and documentation
5. Handle errors appropriately

Code:`
    )

    return {
      files: code.files,
      dependencies: code.dependencies,
      approved: feedback?.approved ?? false,
      feedback: feedback?.feedback,
      metadata: code.metadata,
    }
  }
)
