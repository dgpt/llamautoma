import fastDiff from 'fast-diff'
import { logger } from '@/logger'
import { getFiles } from './file'
import type { File } from '../ai/tools/schemas/file'
import type { DiffEntry } from '../ai/tools/schemas/diff'

/**
 * Core function to generate diffs between files
 * Does not handle compression - that's handled by the caller
 */
export async function generateDiffs(files: File[]): Promise<DiffEntry[]> {
  try {
    // Get all file paths that need to be diffed
    const filePaths = files.map(f => f.path)

    // Request original file contents from client
    const originals = await getFiles(filePaths)

    // Generate diffs for each file
    const changes = await Promise.all(
      files.map(async file => {
        const original = originals[file.path]
        const originalContent = original?.content || ''
        return {
          path: file.path,
          diff: fastDiff(originalContent, file.content) as [number, string][],
        }
      })
    )

    return changes
  } catch (error) {
    logger.error(
      `Error generating diffs: ${error instanceof Error ? error.message : String(error)}`
    )
    throw new Error(
      `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Helper to generate diffs and compress them for client communication
 */
export async function generateCompressedDiffs(files: File[]): Promise<DiffEntry[]> {
  // Since we're not doing compression, just return regular diffs
  return generateDiffs(files)
}
