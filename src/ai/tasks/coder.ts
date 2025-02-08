import { task } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { CoderTaskSchema, ReviewerTaskSchema } from './schemas/tasks'
import { z } from 'zod'
import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { updateProgress, sendTaskResponse, sendTaskComplete } from '../../stream'
import { parseSections } from '../../lib/parse'

/**
 * Parses file sections into structured format
 */
function parseFiles(sections: string[]): Array<{
  path: string
  content: string
  type: 'create' | 'modify' | 'delete'
  description?: string
}> {
  const files = []
  let currentFile: {
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description?: string
  } | null = null

  for (const section of sections) {
    if (section.startsWith('File:') || section.startsWith('Path:')) {
      if (currentFile) {
        files.push(currentFile)
      }
      const [pathLine, ...contentLines] = section.split('\n')
      const path = pathLine.split(':')[1].trim()
      currentFile = {
        path,
        content: '',
        type: 'create',
      }
    } else if (section.startsWith('Description:')) {
      if (currentFile) {
        currentFile.description = section.split(':')[1].trim()
      }
    } else if (currentFile) {
      currentFile.content = section
    }
  }

  if (currentFile) {
    files.push(currentFile)
  }

  return files
}

/**
 * Generates code based on the plan and user requirements
 */
export const coderTask = task(
  'coder',
  async (
    {
      messages,
      plan,
      review,
    }: {
      messages: BaseMessage[]
      plan: string
      review?: z.infer<typeof ReviewerTaskSchema>
    },
    config?: RunnableConfig
  ) => {
    // Update initial progress
    updateProgress('coder', 'Generating code...', config)

    // Convert messages to string for context
    const context = messages.map(getMessageString).join('\n')

    // Generate code using LLM
    const response = await llm.invoke(
      `Generate code based on the following context and plan:

      CONVERSATION CONTEXT:
      ${context}

      PLAN:
      ${plan}

      ${
        review
          ? `REVIEW FEEDBACK:
      ${review.feedback}

      SUGGESTIONS:
      ${review.suggestions?.map((suggestion: { step: string; action: string }) => `- ${suggestion.step}: ${suggestion.action}`).join('\n')}`
          : ''
      }

      Respond with:
      1. A brief explanation of the implementation
      2. The complete code for each file needed
      3. Any dependencies required

      For each file, include:
      - File path
      - Complete file content
      - Brief description of the file's purpose

      Focus on:
      - Code quality and readability
      - Proper error handling
      - Type safety and documentation
      - Testing and maintainability

      Keep the implementation clean and efficient.`
    )

    // Parse response into sections
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const sections = parseSections(content)
    const [explanation, ...fileSections] = sections

    // Parse file sections into structured format
    const files = parseFiles(fileSections)

    // Create structured response
    const result = CoderTaskSchema.parse({
      files,
      response: {
        content: explanation,
        type: 'info',
        shouldDisplay: true,
      },
    })

    // Update progress with completion
    sendTaskComplete('coder', `Generated ${files.length} file(s)`)

    return result
  }
)
