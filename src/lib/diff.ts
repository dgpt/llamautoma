import fastDiff from 'fast-diff'
import { logger } from '@/logger'
import { getFile } from './file'
import { decompressAndDecodeFile } from './compression'
import type { DiffEntry } from '../ai/tools/schemas/diff'

// Functional composition helpers
const getContent = async (path?: string, content?: string): Promise<string> =>
  path ? await getFile(path) : (content ?? '')

const decode = async (content: string): Promise<string> =>
  content.startsWith('~') ? await decompressAndDecodeFile(content) : content

/**
 * Generate a diff between two pieces of code
 * At least one of originalPath or originalContent must be provided
 */
export async function generateDiff(
  newContent: string,
  originalPath?: string,
  originalContent?: string
): Promise<[number, string][]> {
  try {
    if (!originalPath && !originalContent) {
      throw new Error('Either originalPath or originalContent must be provided')
    }

    // Get and decode content using functional composition
    const original = await getContent(originalPath, originalContent)
    const [decodedOriginal, decodedNew] = await Promise.all([decode(original), decode(newContent)])

    // Generate diff
    return fastDiff(decodedOriginal, decodedNew) as [number, string][]
  } catch (error) {
    logger.error(`Error generating diff: ${error instanceof Error ? error.message : String(error)}`)
    throw new Error(
      `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Generate a compressed diff entry for a file
 * At least one of originalPath or originalContent must be provided
 */
export async function generateCompressedDiff(
  path: string,
  newContent: string,
  originalPath?: string,
  originalContent?: string
): Promise<DiffEntry> {
  try {
    // Generate raw diff
    const diff = await generateDiff(newContent, originalPath, originalContent)
    return { path, diff }
  } catch (error) {
    logger.error(
      `Error generating compressed diff: ${error instanceof Error ? error.message : String(error)}`
    )
    return {
      path,
      diff: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
