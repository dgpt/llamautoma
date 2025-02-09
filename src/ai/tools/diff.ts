import { tool } from '@langchain/core/tools'
import { generateDiff, generateCompressedDiff } from '../../lib/diff'
import { DiffInputSchema, DiffOutputSchema, type DiffInput } from './schemas/diff'

// Create the diff tool using LangChain's tool function
export const diffTool = tool(
  async (input: DiffInput) => {
    try {
      // Use core diff library to generate diffs
      const changes = await Promise.all(
        input.files.map(async file => {
          switch (file.type) {
            case 'create':
              // For new files, show all content as added by diffing against empty string
              return {
                path: file.path,
                diff: [[1, file.content]],
              }
            case 'delete':
              // For deletions, show all content as removed by diffing existing against empty
              return {
                path: file.path,
                diff: [[-1, file.content]],
              }
            default:
              // For updates, diff new content against existing file
              return generateCompressedDiff(file.path, file.content, file.path, undefined)
          }
        })
      )

      // Validate output against schema
      const result = DiffOutputSchema.parse(changes)

      // Return diffs as JSON string for LLM consumption
      return JSON.stringify(result, null, 2)
    } catch (error) {
      throw new Error(
        `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },
  {
    name: 'diff',
    description: 'Generate diffs between generated code and existing files in the workspace',
    schema: DiffInputSchema,
  }
)
