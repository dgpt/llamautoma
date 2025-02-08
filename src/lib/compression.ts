import { encode as base85Encode, decode as base85Decode } from '@alttiri/base85'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack'
import { logger } from '@/logger'
import { task } from '@langchain/langgraph'
import type { File } from '../ai/tools/schemas/file'

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
export async function encodeGeneratedFiles(files: File[]): Promise<File[]> {
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
export async function decodeGeneratedFiles(files: File[]): Promise<File[]> {
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

/**
 * Decodes a single file's content using Base85 + Brotli
 * Used by file tool for handling individual file content
 */
export async function decodeFile(encodedStr: string): Promise<string> {
  try {
    // First decode from Base85
    const compressed = Buffer.from(base85Decode(encodedStr))
    // Then decompress with Brotli
    const decompressed = brotliDecompressSync(compressed)
    return decompressed.toString('utf-8')
  } catch (error) {
    logger.error('Error decoding file:', error)
    throw new Error('Failed to decode file')
  }
}

/**
 * Compresses and encodes messages using MessagePack + Base85
 * Used for compressing tool responses and other JSON data
 */
export function compressAndEncodeMessage(data: any): string {
  try {
    // First use MessagePack to serialize
    const msgpacked = msgpackEncode(data)
    // Then encode with Base85 for JSON safety
    return base85Encode(Buffer.from(msgpacked))
  } catch (error) {
    logger.error('Error compressing and encoding message:', error)
    throw new Error('Failed to compress and encode message')
  }
}

/**
 * Decodes and decompresses messages using Base85 + MessagePack
 * Used for decompressing tool responses and other JSON data
 */
export function decodeAndDecompressMessage(encodedStr: string): any {
  try {
    // First decode from Base85
    const msgpacked = Buffer.from(base85Decode(encodedStr))
    // Then decode MessagePack
    return msgpackDecode(msgpacked)
  } catch (error) {
    logger.error('Error decoding and decompressing message:', error)
    throw new Error('Failed to decode and decompress message')
  }
}

/**
 * Compresses and encodes file content using Brotli + Base85
 * Used for compressing individual file content
 */
export async function compressAndEncodeFile(content: string): Promise<string> {
  try {
    // First compress with Brotli
    const compressed = brotliCompressSync(Buffer.from(content))
    // Then encode with Base85 for JSON safety
    return base85Encode(compressed)
  } catch (error) {
    logger.error('Error compressing and encoding file:', error)
    throw new Error('Failed to compress and encode file')
  }
}
