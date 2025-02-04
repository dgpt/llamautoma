import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { createStructuredLLM } from '../llm'
import { getMessageString } from './utils'
import type { Plan } from './planner'
import type { Feedback } from '../llm'

// Schema for generated code
export const codeSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      language: z.string(),
    })
  ),
  dependencies: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        type: z.enum(['npm', 'pip', 'cargo', 'go']),
      })
    )
    .optional(),
  approved: z.boolean(),
  feedback: z.string().optional(),
})

export type GeneratedCode = z.infer<typeof codeSchema>

// Create coder with structured output
const coder = createStructuredLLM(codeSchema)

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
      ...code,
      approved: feedback?.approved ?? false,
      feedback: feedback?.feedback,
    }
  }
)
