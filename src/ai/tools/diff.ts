import { tool } from '@langchain/core/tools'
import { generateDiffs } from '../../lib/diff'
import { DiffInputSchema, DiffOutputSchema, type DiffInput } from './schemas/diff'

// Create the diff tool using LangChain's tool function
export const diffTool = tool(
  async (input: DiffInput) => {
    try {
      // Use core diff library to generate diffs
      const changes = await generateDiffs(input.files)

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
