import { expect, test, describe, spyOn, beforeEach, afterEach } from 'bun:test'
import { generateDiff, generateCompressedDiff } from '@/lib/diff'
import * as fileLib from '@/lib/file'
import * as compression from '@/lib/compression'
import fastDiff from 'fast-diff'

describe('Diff Library', () => {
  // Mock dependencies
  let getFileSpy: ReturnType<typeof spyOn>
  let decompressAndDecodeFileSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    // Mock file operations
    getFileSpy = spyOn(fileLib, 'getFile')
    getFileSpy.mockImplementation(() => Promise.resolve('~original content'))

    // Mock compression
    decompressAndDecodeFileSpy = spyOn(compression, 'decompressAndDecodeFile')
    decompressAndDecodeFileSpy.mockImplementation(async (content: string) =>
      content.startsWith('~') ? content.slice(1) : content
    )
  })

  afterEach(() => {
    getFileSpy.mockRestore()
    decompressAndDecodeFileSpy.mockRestore()
  })

  describe('generateDiff', () => {
    test('should generate diff between file and new content', async () => {
      const originalPath = 'test.ts'
      const newContent = '~new content'

      const diff = await generateDiff(newContent, originalPath)

      expect(diff).toEqual(fastDiff('original content', 'new content'))
      expect(getFileSpy).toHaveBeenCalledWith(originalPath)
      expect(decompressAndDecodeFileSpy).toHaveBeenCalledTimes(2)
    })

    test('should generate diff between original content and new content', async () => {
      const originalContent = '~original content'
      const newContent = '~new content'

      const diff = await generateDiff(newContent, undefined, originalContent)

      expect(diff).toEqual(fastDiff('original content', 'new content'))
      expect(getFileSpy).not.toHaveBeenCalled()
      expect(decompressAndDecodeFileSpy).toHaveBeenCalledTimes(2)
    })

    test('should handle compressed content', async () => {
      const originalContent = '~compressed original'
      const newContent = '~compressed new'

      const diff = await generateDiff(newContent, undefined, originalContent)

      expect(diff).toEqual(fastDiff('compressed original', 'compressed new'))
      expect(decompressAndDecodeFileSpy).toHaveBeenCalledTimes(2)
    })

    test('should throw when neither path nor content provided', async () => {
      await expect(generateDiff('new content')).rejects.toThrow(
        'Either originalPath or originalContent must be provided'
      )
    })

    test('should handle file read errors', async () => {
      getFileSpy.mockImplementation(() => Promise.reject(new Error('File read error')))

      await expect(generateDiff('new content', 'test.ts')).rejects.toThrow('File read error')
    })

    test('should handle decompression errors', async () => {
      decompressAndDecodeFileSpy.mockImplementation(() =>
        Promise.reject(new Error('Decompression error'))
      )

      await expect(generateDiff('new content', undefined, '~invalid')).rejects.toThrow(
        'Decompression error'
      )
    })
  })

  describe('generateCompressedDiff', () => {
    test('should generate compressed diff entry', async () => {
      const path = 'test.ts'
      const newContent = '~new content'

      const entry = await generateCompressedDiff(path, newContent, path)

      expect(entry).toHaveProperty('path', path)
      expect(entry.diff).toEqual(fastDiff('original content', 'new content'))
      expect(entry.error).toBeUndefined()
    })

    test('should handle errors gracefully', async () => {
      const path = 'test.ts'
      getFileSpy.mockImplementation(() => Promise.reject(new Error('File error')))

      const entry = await generateCompressedDiff(path, 'new content', path)

      expect(entry).toHaveProperty('path', path)
      expect(entry).toHaveProperty('error', 'Failed to generate diff: File error')
      expect(entry.diff).toHaveLength(0)
    })

    test('should handle both compressed and uncompressed content', async () => {
      const path = 'test.ts'
      const newContent = '~compressed new'
      const originalContent = '~uncompressed original'

      const entry = await generateCompressedDiff(path, newContent, undefined, originalContent)

      expect(entry).toHaveProperty('path', path)
      expect(entry.diff).toEqual(fastDiff('uncompressed original', 'compressed new'))
      expect(entry.error).toBeUndefined()
      expect(decompressAndDecodeFileSpy).toHaveBeenCalledTimes(2)
    })
  })
})
