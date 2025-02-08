import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { fileTool } from '@/ai/tools/file'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const FIXTURES_DIR = join(process.cwd(), 'tests/fixtures/file-tool')

describe('File Tool', () => {
  beforeAll(async () => {
    // Ensure test files exist
    // Already created by our setup command
  })

  afterAll(async () => {
    // Clean up test files
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  test('should handle single file request', async () => {
    const result = await fileTool.invoke({
      requestType: 'file',
      paths: [join(FIXTURES_DIR, 'test/file.txt')],
    })
    const parsed = JSON.parse(result)
    expect(parsed[join(FIXTURES_DIR, 'test/file.txt')]).toEqual({
      path: join(FIXTURES_DIR, 'test/file.txt'),
      content: 'test file content\n',
    })
  })

  test('should handle multiple files request', async () => {
    const result = await fileTool.invoke({
      requestType: 'files',
      paths: [join(FIXTURES_DIR, 'test/file1.txt'), join(FIXTURES_DIR, 'test/file2.txt')],
    })
    const parsed = JSON.parse(result)
    expect(parsed[join(FIXTURES_DIR, 'test/file1.txt')]).toEqual({
      path: join(FIXTURES_DIR, 'test/file1.txt'),
      content: 'test file 1 content\n',
    })
    expect(parsed[join(FIXTURES_DIR, 'test/file2.txt')]).toEqual({
      path: join(FIXTURES_DIR, 'test/file2.txt'),
      content: 'test file 2 content\n',
    })
  })

  test('should handle directory request', async () => {
    const result = await fileTool.invoke({
      requestType: 'directory',
      paths: [join(FIXTURES_DIR, 'test/dir')],
      includePattern: '.ts',
    })
    const parsed = JSON.parse(result)
    expect(parsed[join(FIXTURES_DIR, 'test/dir')]).toEqual({
      path: join(FIXTURES_DIR, 'test/dir'),
      content: 'test ts file\n',
    })
  })

  test('should handle multiple directories request', async () => {
    const result = await fileTool.invoke({
      requestType: 'directories',
      paths: [join(FIXTURES_DIR, 'test/dir1'), join(FIXTURES_DIR, 'test/dir2')],
      excludePattern: '.test.ts',
    })
    const parsed = JSON.parse(result)
    expect(parsed[join(FIXTURES_DIR, 'test/dir1')]).toEqual({
      path: join(FIXTURES_DIR, 'test/dir1'),
      content: 'test ts file 1\n',
    })
    expect(parsed[join(FIXTURES_DIR, 'test/dir2')]).toEqual({
      path: join(FIXTURES_DIR, 'test/dir2'),
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
