import { expect, test, describe, mock, beforeEach, afterEach } from 'bun:test'
import { fileTool } from '@/ai/tools/file'
import * as fileLib from '@/lib/file'

describe('File Tool', () => {
  const originalResponse = globalThis.Response
  let mockResponse: ReturnType<typeof mock>
  let mockFileSystem: Map<string, string> = new Map()

  beforeEach(() => {
    mockResponse = mock(() => {})
    mockResponse.prototype = originalResponse.prototype
    globalThis.Response = mockResponse as unknown as typeof Response

    // Set up test fixtures
    mockFileSystem.set('test1.txt', 'test file content\n')
    mockFileSystem.set('test2.txt', 'test file 2 content\n')
    mockFileSystem.set('test/dir/file.ts', 'test ts file\n')
    mockFileSystem.set('test/dir1/file.ts', 'test ts file 1\n')
    mockFileSystem.set('test/dir2/file.ts', 'test ts file 2\n')

    // Mock the file library
    mock.module('@/lib/file', () => ({
      ...fileLib,
      getFile: async (path: string) => {
        const content = mockFileSystem.get(path)
        if (!content) throw new Error('File not found')
        return content
      },
      getDirectory: async (
        path: string,
        _config: any,
        includePattern?: string,
        excludePattern?: string
      ) => {
        const files: Record<string, string> = {}
        const normalizedPath = path.endsWith('/') ? path : path + '/'
        for (const [filePath, content] of mockFileSystem.entries()) {
          if (!filePath.startsWith(normalizedPath)) continue
          if (includePattern && !filePath.endsWith(includePattern)) continue
          if (excludePattern && filePath.endsWith(excludePattern)) continue
          files[filePath] = content
        }
        return files
      },
    }))
  })

  afterEach(() => {
    mockFileSystem.clear()
    mock.restore()
    globalThis.Response = originalResponse
  })

  test('should handle single file request', async () => {
    const result = await fileTool.invoke({
      requestType: 'file',
      paths: ['test1.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      content: 'test file content\n',
    })
  })

  test('should handle multiple files request', async () => {
    const result = await fileTool.invoke({
      requestType: 'files',
      paths: ['test1.txt', 'test2.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      content: 'test file content\n',
    })
    expect(parsed['test2.txt']).toEqual({
      path: 'test2.txt',
      content: 'test file 2 content\n',
    })
  })

  test('should handle directory request', async () => {
    const result = await fileTool.invoke({
      requestType: 'directory',
      paths: ['test/dir'],
      includePattern: '.ts',
    })
    const parsed = JSON.parse(result)
    expect(parsed['test/dir']).toEqual({
      path: 'test/dir',
      files: {
        'test/dir/file.ts': 'test ts file\n',
      },
    })
  })

  test('should handle multiple directories request', async () => {
    const result = await fileTool.invoke({
      requestType: 'directories',
      paths: ['test/dir1', 'test/dir2'],
      excludePattern: '.test.ts',
    })
    const parsed = JSON.parse(result)
    expect(parsed['test/dir1']).toEqual({
      path: 'test/dir1',
      files: {
        'test/dir1/file.ts': 'test ts file 1\n',
      },
    })
    expect(parsed['test/dir2']).toEqual({
      path: 'test/dir2',
      files: {
        'test/dir2/file.ts': 'test ts file 2\n',
      },
    })
  })

  test('should handle empty paths array', async () => {
    await expect(
      fileTool.invoke({
        requestType: 'files',
        paths: [],
      })
    ).rejects.toThrow('No paths provided')
  })

  test('should handle invalid request type', async () => {
    // @ts-expect-error Testing invalid request type
    await expect(fileTool.invoke({ requestType: 'invalid', paths: [] })).rejects.toThrow()
  })

  test('should handle file not found error', async () => {
    const result = await fileTool.invoke({
      requestType: 'file',
      paths: ['nonexistent.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['nonexistent.txt']).toEqual({
      path: 'nonexistent.txt',
      error: 'File not found',
    })
  })

  test('should handle empty directory', async () => {
    const result = await fileTool.invoke({
      requestType: 'directory',
      paths: ['test/empty'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['test/empty']).toEqual({
      path: 'test/empty',
      files: {},
    })
  })

  test('should handle invalid tool configuration', async () => {
    const result = await fileTool.invoke(
      {
        requestType: 'file',
        paths: ['test1.txt'],
      },
      {
        configurable: {
          userInputTimeout: -1, // Invalid timeout
        },
      }
    )
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      content: 'test file content\n',
    })
  })

  test('should handle overall tool error', async () => {
    await expect(
      fileTool.invoke({
        requestType: 'directory',
        paths: [null as unknown as string],
      })
    ).rejects.toThrow()
  })

  test('should handle undefined options', async () => {
    const result = await fileTool.invoke({
      requestType: 'file',
      paths: ['test1.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      content: 'test file content\n',
    })
  })

  test('should handle undefined configurable in options', async () => {
    const result = await fileTool.invoke(
      {
        requestType: 'file',
        paths: ['test1.txt'],
      },
      {}
    )
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      content: 'test file content\n',
    })
  })

  test('should handle non-Error objects in error handling', async () => {
    // Mock getFile to throw a non-Error object
    mock.module('@/lib/file', () => ({
      ...fileLib,
      getFile: async () => {
        throw 'Custom error string'
      },
      getDirectory: fileLib.getDirectory,
    }))

    const result = await fileTool.invoke({
      requestType: 'file',
      paths: ['test1.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['test1.txt']).toEqual({
      path: 'test1.txt',
      error: 'Custom error string',
    })
  })

  test('should handle outer try-catch errors', async () => {
    // Mock JSON.stringify to throw an error
    const originalStringify = JSON.stringify
    globalThis.JSON.stringify = () => {
      throw new Error('JSON error')
    }

    try {
      await expect(
        fileTool.invoke({
          requestType: 'file',
          paths: ['test1.txt'],
        })
      ).rejects.toThrow('Failed to read files: JSON error')
    } finally {
      globalThis.JSON.stringify = originalStringify
    }
  })
})
