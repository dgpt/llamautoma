import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import fastDiff, { Diff } from 'fast-diff'
import { fileTask, FileResponse } from '../tasks/file'

// Schema for diff input
const diffInputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      language: z.string(),
    })
  ),
})

// Schema for diff output
const diffOutputSchema = z.array(
  z.object({
    path: z.string(),
    diff: z.array(z.tuple([z.number(), z.string()])),
    error: z.string().optional(),
  })
)

export class DiffTool extends StructuredTool {
  name = 'diff'
  description = 'Generate diffs between generated code and existing files in the workspace'
  schema = diffInputSchema

  async _call(input: z.infer<typeof diffInputSchema>): Promise<string> {
    try {
      // Get all file paths that need to be diffed
      const filePaths = input.files.map(f => f.path)

      // Request original file contents from client
      const originals = await fileTask({
        type: 'files',
        paths: filePaths,
      })

      // Generate diffs for each file
      const changes = input.files.map(file => {
        const original = originals[file.path]

        if (original?.error) {
          return {
            path: file.path,
            diff: fastDiff('', file.content), // Empty string for new files
            error: original.error,
          }
        }

        return {
          path: file.path,
          diff: fastDiff(original?.content || '', file.content),
        }
      })

      // Validate output against schema
      const result = diffOutputSchema.parse(changes)

      // Return formatted result
      return JSON.stringify(result, null, 2)
    } catch (error) {
      throw new Error(
        `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
