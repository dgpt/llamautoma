import { expect, test, describe } from 'bun:test'
import {
  compressTask,
  decompressTask,
  encodeGeneratedFiles,
  decodeGeneratedFiles,
  decodeFile,
  compressAndEncodeMessage,
  decodeAndDecompressMessage,
  compressAndEncodeFile,
} from '@/lib/compression'
import type { File } from '@/ai/tools/schemas/file'

describe('Compression Library', () => {
  describe('File Content Compression', () => {
    test('should compress and decompress file content', async () => {
      const content = 'Hello, World!'
      const compressed = await compressTask(content)
      const decompressed = await decompressTask(compressed)
      expect(decompressed).toBe(content)
    })

    test('should handle empty content', async () => {
      const content = ''
      const compressed = await compressTask(content)
      const decompressed = await decompressTask(compressed)
      expect(decompressed).toBe(content)
    })

    test('should handle large content', async () => {
      const content = 'x'.repeat(1000000) // 1MB of data
      const compressed = await compressTask(content)
      const decompressed = await decompressTask(compressed)
      expect(decompressed).toBe(content)
      expect(compressed.length).toBeLessThan(content.length)
    })
  })

  describe('Generated Files Encoding', () => {
    test('should encode and decode generated files', async () => {
      const files: File[] = [
        {
          path: 'test1.ts',
          content: 'console.log("test1")',
          type: 'create',
        },
        {
          path: 'test2.ts',
          content: 'console.log("test2")',
          type: 'update',
        },
      ]

      const encoded = await encodeGeneratedFiles(files)
      const decoded = await decodeGeneratedFiles(encoded)

      expect(decoded).toHaveLength(2)
      expect(decoded[0].content).toBe(files[0].content)
      expect(decoded[1].content).toBe(files[1].content)
    })

    test('should preserve file metadata during encoding', async () => {
      const files: File[] = [
        {
          path: 'test.ts',
          content: 'console.log("test")',
          type: 'create',
          description: 'Test file',
        },
      ]

      const encoded = await encodeGeneratedFiles(files)
      const decoded = await decodeGeneratedFiles(encoded)

      expect(decoded[0].path).toBe(files[0].path)
      expect(decoded[0].type).toBe(files[0].type)
      expect(decoded[0].description).toBe(files[0].description)
    })
  })

  describe('Single File Operations', () => {
    test('should decode single file content', async () => {
      const content = 'console.log("test")'
      const encoded = await compressAndEncodeFile(content)
      const decoded = await decodeFile(encoded)
      expect(decoded).toBe(content)
    })

    test('should handle invalid encoded content', async () => {
      await expect(decodeFile('invalid-content')).rejects.toThrow()
    })
  })

  describe('Message Compression', () => {
    test('should compress and decompress messages', () => {
      const message = { test: 'value', number: 42, array: [1, 2, 3] }
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
    })

    test('should handle complex objects', () => {
      const message = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 'two', { three: 3 }],
        nested: {
          a: 1,
          b: [2, 3],
          c: { d: 4 },
        },
      }
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
    })

    test('should handle empty objects', () => {
      const message = {}
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
    })

    test('should handle arrays', () => {
      const message = [1, 2, 3]
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
    })

    test('should handle invalid compressed content', () => {
      expect(() => decodeAndDecompressMessage('invalid-content')).toThrow()
    })
  })
})
