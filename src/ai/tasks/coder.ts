import { task } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { CoderTaskSchema, ReviewerTaskSchema } from './schemas/tasks'
import { FileSchema } from '../tools/schemas/file'
import { z } from 'zod'
import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { updateProgress, sendTaskResponse, sendTaskComplete } from '../utils/stream'
import { parseSections } from '../lib/parse'

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

    // Parse response sections
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const [explanation, ...sections] = parseSections(content)

    // Send explanation to chat window
    sendTaskResponse('coder', explanation)

    // Parse file sections
    const files = []
    let currentFile = null

    for (const section of sections) {
      if (section.startsWith('File:') || section.startsWith('Path:')) {
        // Start new file
        if (currentFile) {
          files.push(currentFile)
          // Send file info to chat window
          sendTaskResponse(
            'coder',
            `\nCreating file: ${currentFile.path}\n${currentFile.description || ''}`
          )
        }
        const [pathLine, ...contentLines] = section.split('\n')
        const path = pathLine.split(':')[1].trim()
        currentFile = {
          path,
          content: '',
          type: 'create' as const,
          description: '',
        }
      } else if (section.startsWith('Description:')) {
        // Add description to current file
        if (currentFile) {
          currentFile.description = section.split(':')[1].trim()
        }
      } else if (currentFile) {
        // Add content to current file
        currentFile.content = section
      }
    }

    // Add last file
    if (currentFile) {
      files.push(currentFile)
      // Send last file info to chat window
      sendTaskResponse(
        'coder',
        `\nCreating file: ${currentFile.path}\n${currentFile.description || ''}`
      )
    }

    // Validate files
    const validatedFiles = files.map(file => FileSchema.parse(file))

    // Create structured response
    const result = CoderTaskSchema.parse({
      files: validatedFiles,
      explanation,
      response: `Generated ${validatedFiles.length} file(s):\n${validatedFiles
        .map(f => `- ${f.path}`)
        .join('\n')}`,
    })

    // Update progress with completion
    sendTaskComplete('coder', `Generated ${validatedFiles.length} file(s)`)

    return result
  }
)
