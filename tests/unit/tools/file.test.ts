import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { fileTool } from '@/ai/tools/file'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

describe('File Tool', () => {
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
      content: 'test file 1 content\n',
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
      content: 'test ts file\n',
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
      content: 'test ts file 1\n',
    })
    expect(parsed['test/dir2']).toEqual({
      path: 'test/dir2',
      content: 'test ts file 2\n',
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

  test('should handle overall tool error', async () => {
    await expect(
      fileTool.invoke({
        requestType: 'directory',
        paths: [null as unknown as string],
      })
    ).rejects.toThrow()
  })
})
