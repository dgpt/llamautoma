import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import fastDiff from 'fast-diff'
import { fileTool } from './file'
import type { FileOp } from 'llamautoma-types'
import { decodeGeneratedFiles, encodeGeneratedFiles } from '../lib/compression'

// Schema for diff input
const diffInputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      type: z.enum(['create', 'modify', 'delete']),
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

type FileResponse = {
  [path: string]: FileOp
}

// Create the diff tool using LangChain's tool function
export const diffTool = tool(
  async (input: z.infer<typeof diffInputSchema>) => {
    try {
      // Get all file paths that need to be diffed
      const filePaths = input.files.map(f => f.path)

      // Request original file contents from client
      const originals = JSON.parse(
        await fileTool.invoke({
          requestType: 'files',
          paths: filePaths,
        })
      ) as FileResponse

      // Decode input files
      const decodedFiles = await decodeGeneratedFiles(
        input.files.map(f => ({
          ...f,
          description: `Input file for diffing: ${f.path}`,
        }))
      )

      // Generate diffs for each file
      const changes = await Promise.all(
        decodedFiles.map(async file => {
          const original = originals[file.path]

          if (original?.error) {
            return {
              path: file.path,
              diff: fastDiff('', file.content), // Empty string for new files
              error: original.error,
            }
          }

          // Decode original file if it exists
          let originalContent = ''
          if (original?.content) {
            const [decodedOriginal] = await decodeGeneratedFiles([
              {
                path: file.path,
                content: original.content,
                type: 'modify',
                description: `Original file for diffing: ${file.path}`,
              },
            ])
            originalContent = decodedOriginal.content
          }

          return {
            path: file.path,
            diff: fastDiff(originalContent, file.content),
          }
        })
      )

      // Validate output against schema
      const result = diffOutputSchema.parse(changes)

      // Compress the diff output
      const compressedResult = await encodeGeneratedFiles(
        result.map(change => ({
          path: change.path,
          content: JSON.stringify(change.diff),
          type: 'modify',
          description: `Diff result for: ${change.path}`,
        }))
      )

      // Return compressed diffs
      return JSON.stringify(
        compressedResult.map(compressed => ({
          path: compressed.path,
          diff: JSON.parse(compressed.content),
          error: changes.find(c => c.path === compressed.path)?.error,
        })),
        null,
        2
      )
    } catch (error) {
      throw new Error(
        `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },
  {
    name: 'diff',
    description: 'Generate diffs between generated code and existing files in the workspace',
    schema: diffInputSchema,
  }
)
