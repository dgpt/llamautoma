import { expect, test, describe, beforeAll, afterAll, mock } from 'bun:test'
import { fileTool } from '@/ai/tools/file'
import { mockFileSystem } from '@/tests/unit/utils'

// Mock the file module
mock.module('@/lib/file', () => ({
  getFile: async (path: string) => {
    const content = mockFileSystem.get(path)
    if (!content) {
      throw new Error('File not found')
    }
    return content
  },
  getDirectory: async (path: string) => {
    const files: Record<string, string> = {}
    for (const [key, value] of mockFileSystem.entries()) {
      // Only include files that are direct children of the directory
      if (key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')) {
        files[key] = value
      }
    }
    // Always return files object, even if empty
    return files
  },
}))

describe('File Tool', () => {
  beforeAll(() => {
    // Set up test fixtures
    mockFileSystem.set('test1.txt', 'test file content\n')
    mockFileSystem.set('test2.txt', 'test file 2 content\n')
    mockFileSystem.set('test/dir/file.ts', 'test ts file\n')
    mockFileSystem.set('test/dir1/file.ts', 'test ts file 1\n')
    mockFileSystem.set('test/dir2/file.ts', 'test ts file 2\n')
  })

  afterAll(() => {
    // Clean up test fixtures
    mockFileSystem.clear()
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
})
