import { task } from '@langchain/langgraph'
import fastDiff, { Diff } from 'fast-diff'
import { fileTask } from './file'
import type { GeneratedCode } from './coder'

type DiffResults = {
  path: string
  diff: Diff[]
  error?: string
}

// Create the diff task
export const diffTask = task(
  'diff',
  async ({ code }: { code: GeneratedCode }): Promise<DiffResults[]> => {
    // Get all file paths that need to be diffed
    const filePaths = code.files.map(f => f.path)

    // Request original file contents from client
    const originals = await fileTask({
      type: 'files',
      paths: filePaths,
    })

    // Generate diffs for each file
    const changes = code.files.map(file => {
      const original = originals.find(o => o.path === file.path)

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

    return changes
  }
)
