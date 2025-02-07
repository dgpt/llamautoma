import { encode as base85Encode, decode as base85Decode } from '@alttiri/base85'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { logger } from '@/logger'
import { task } from '@langchain/langgraph'
import { z } from 'zod'

// Schema for file operations
export const FileSchema = z.object({
  path: z.string(),
  content: z.string(),
  type: z.enum(['create', 'modify', 'delete']),
  description: z.string().optional(),
})

/**
 * Compresses and encodes file content using Brotli + Base85
 * Used by AI tasks when handling file content in JSON messages
 */
export const compressTask = task('compress', async (content: string): Promise<string> => {
  try {
    // First compress with Brotli
    const compressed = brotliCompressSync(Buffer.from(content))
    // Then encode with Base85 for JSON safety
    return base85Encode(compressed)
  } catch (error) {
    logger.error('Error compressing and encoding file:', error)
    throw new Error('Failed to compress and encode file')
  }
})

/**
 * Decodes and decompresses file content using Base85 + Brotli
 * Used by AI tasks when handling file content in JSON messages
 */
export const decompressTask = task('decompress', async (encodedStr: string): Promise<string> => {
  try {
    // First decode from Base85
    const compressed = Buffer.from(base85Decode(encodedStr))
    // Then decompress with Brotli
    const decompressed = brotliDecompressSync(compressed)
    return decompressed.toString('utf-8')
  } catch (error) {
    logger.error('Error decoding and decompressing file:', error)
    throw new Error('Failed to decode and decompress file')
  }
})

/**
 * Helper to encode file content in GeneratedCode
 */
export async function encodeGeneratedFiles(
  files: Array<{
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description: string
  }>
): Promise<
  Array<{
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description: string
  }>
> {
  try {
    const encodedFiles = await Promise.all(
      files.map(async file => ({
        ...file,
        content: await compressTask(file.content),
      }))
    )
    return encodedFiles
  } catch (error) {
    logger.error('Error encoding generated files:', error)
    throw new Error('Failed to encode generated files')
  }
}

/**
 * Helper to decode file content in GeneratedCode
 */
export async function decodeGeneratedFiles(
  files: Array<{
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description: string
  }>
): Promise<
  Array<{
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description: string
  }>
> {
  try {
    const decodedFiles = await Promise.all(
      files.map(async file => ({
        ...file,
        content: await decompressTask(file.content),
      }))
    )
    return decodedFiles
  } catch (error) {
    logger.error('Error decoding generated files:', error)
    throw new Error('Failed to decode generated files')
  }
}
