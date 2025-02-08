import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import {
  encodeGeneratedFiles,
  decodeGeneratedFiles,
  compressAndEncodeFile,
  decompressAndDecodeFile,
  compressAndEncodeMessage,
  decodeAndDecompressMessage,
} from '@/lib/compression'
import type { File } from '@/ai/tools/schemas/file'
import * as base85 from '@alttiri/base85'
import { encode as msgpackEncode } from '@msgpack/msgpack'

// Test file type with required description
type TestFile = Required<File>

describe('Compression Library', () => {
  let originalBufferFrom: typeof Buffer.from
  let mockBase85: {
    encode: (ui8a: Uint8Array) => string
    decode: (base85: string) => Uint8Array
  }

  beforeEach(() => {
    originalBufferFrom = Buffer.from
    // Mock base85 module with default behavior
    mockBase85 = {
      encode: base85.encode,
      decode: base85.decode,
    }
    mock.module('@alttiri/base85', () => mockBase85)
  })

  afterEach(() => {
    Buffer.from = originalBufferFrom
    mock.restore()
  })

  describe('File Content Compression', () => {
    test('should compress and decompress file content', async () => {
      const content = 'Hello, World!'
      const compressed = await compressAndEncodeFile(content)
      const decompressed = await decompressAndDecodeFile(compressed)
      expect(decompressed).toBe(content)
      expect(compressed.startsWith('~')).toBe(true)
    })

    test('should handle empty content', async () => {
      const content = ''
      const compressed = await compressAndEncodeFile(content)
      const decompressed = await decompressAndDecodeFile(compressed)
      expect(decompressed).toBe(content)
      expect(compressed.startsWith('~')).toBe(true)
    })

    test('should handle large content', async () => {
      const content = 'x'.repeat(1000000) // 1MB of data
      const compressed = await compressAndEncodeFile(content)
      const decompressed = await decompressAndDecodeFile(compressed)
      expect(decompressed).toBe(content)
      expect(compressed.startsWith('~')).toBe(true)
      expect(compressed.length).toBeLessThan(content.length)
    })

    test('should handle uncompressed content in decompression', async () => {
      const content = 'uncompressed content'
      const decompressed = await decompressAndDecodeFile(content)
      expect(decompressed).toBe(content)
    })

    test('should handle compression errors', async () => {
      Buffer.from = () => {
        throw new Error('Mock compression error')
      }

      await expect(compressAndEncodeFile('test')).rejects.toThrow(
        'Failed to compress and encode file'
      )
    })

    test('should handle invalid input types in decompression', async () => {
      // Test exact string values
      await expect(decompressAndDecodeFile('null')).rejects.toThrow('Failed to decode file')
      await expect(decompressAndDecodeFile('undefined')).rejects.toThrow('Failed to decode file')
      await expect(decompressAndDecodeFile('[object Object]')).rejects.toThrow(
        'Failed to decode file'
      )
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
      expect(encoded[0].content.startsWith('~')).toBe(true)
      expect(encoded[1].content.startsWith('~')).toBe(true)
    })

    test('should preserve file metadata during encoding', async () => {
      const files: TestFile[] = [
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
      expect(encoded[0].content.startsWith('~')).toBe(true)
    })

    test('should handle encoding errors', async () => {
      const files: File[] = [
        {
          path: 'test.ts',
          content: null as unknown as string,
          type: 'create',
        },
      ]

      await expect(encodeGeneratedFiles(files)).rejects.toThrow('Failed to encode generated files')
    })

    test('should handle decoding errors', async () => {
      const files: File[] = [
        {
          path: 'test.ts',
          content: '~invalid-base85',
          type: 'create',
        },
      ]

      await expect(decodeGeneratedFiles(files)).rejects.toThrow('Failed to decode generated files')
    })
  })

  describe('Message Compression', () => {
    test('should compress and decompress messages', () => {
      const message = { test: 'value', number: 42, array: [1, 2, 3] }
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
      expect(compressed.startsWith('~')).toBe(true)
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
      expect(compressed.startsWith('~')).toBe(true)
    })

    test('should handle empty objects', () => {
      const message = {}
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
      expect(compressed.startsWith('~')).toBe(true)
    })

    test('should handle arrays', () => {
      const message = [1, 2, 3]
      const compressed = compressAndEncodeMessage(message)
      const decompressed = decodeAndDecompressMessage(compressed)
      expect(decompressed).toEqual(message)
      expect(compressed.startsWith('~')).toBe(true)
    })

    test('should handle uncompressed content', () => {
      const content = 'uncompressed content'
      const decompressed = decodeAndDecompressMessage(content)
      expect(decompressed).toBe(content)
    })

    test('should handle invalid compressed content', () => {
      mockBase85.decode = () => {
        throw new Error('Invalid base85')
      }
      expect(() => decodeAndDecompressMessage('~invalid-base85')).toThrow()
    })

    test('should handle compression errors in message encoding', () => {
      // Create a circular reference
      const circular: any = { a: 1 }
      circular.self = circular

      expect(() => compressAndEncodeMessage(circular)).toThrow(
        'Failed to compress and encode message'
      )
    })

    test('should handle base85 and msgpack decoding', () => {
      // Test successful decoding of object
      const testObj = { test: 'value' }
      const msgpacked = msgpackEncode(testObj)
      const base85ed = '~' + base85.encode(Buffer.from(msgpacked))
      const decoded = decodeAndDecompressMessage(base85ed)
      expect(decoded).toEqual(testObj)

      // Test successful decoding of primitive value
      const testNumber = 42
      const numberMsgpacked = msgpackEncode(testNumber)
      const numberBase85ed = '~' + base85.encode(Buffer.from(numberMsgpacked))
      const numberDecoded = decodeAndDecompressMessage(numberBase85ed)
      expect(numberDecoded).toBe(testNumber)

      // Test with malformed base85 content
      mockBase85.decode = () => {
        throw new Error('Invalid base85')
      }
      expect(() => decodeAndDecompressMessage('~invalid_base85')).toThrow()

      // Test with valid base85 but invalid msgpack
      mockBase85.decode = () => new Uint8Array([0xff, 0xff, 0xff])
      expect(() => decodeAndDecompressMessage('~invalid-msgpack')).toThrow()
    })
  })
})
