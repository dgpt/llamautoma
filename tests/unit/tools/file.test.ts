import { expect, test, describe, beforeEach } from 'bun:test'
import { FileTool } from '@/ai/tools/file'

describe('File Tool', () => {
  let tool: FileTool

  beforeEach(() => {
    tool = new FileTool()
  })

  test('should handle single file request', async () => {
    const result = await tool.invoke({
      requestType: 'file',
      paths: ['src/index.ts'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['src/index.ts']).toEqual({
      path: 'src/index.ts',
      content: expect.any(String),
    })
  })

  test('should handle multiple files request', async () => {
    const result = await tool.invoke({
      requestType: 'files',
      paths: ['src/index.ts', 'package.json'],
    })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('src/index.ts')
    expect(parsed).toHaveProperty('package.json')
  })

  test('should handle directory request', async () => {
    const result = await tool.invoke({
      requestType: 'directory',
      paths: ['src'],
    })
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed).length).toBeGreaterThan(0)
  })

  test('should handle multiple directories request', async () => {
    const result = await tool.invoke({
      requestType: 'directories',
      paths: ['src', 'tests'],
    })
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed).length).toBeGreaterThan(0)
  })

  test('should handle include pattern', async () => {
    const result = await tool.invoke({
      requestType: 'files',
      paths: ['src'],
      includePattern: '*.ts',
    })
    const parsed = JSON.parse(result)
    Object.keys(parsed).forEach(path => {
      expect(path).toMatch(/\.ts$/)
    })
  })

  test('should handle exclude pattern', async () => {
    const result = await tool.invoke({
      requestType: 'files',
      paths: ['src'],
      excludePattern: '*.test.ts',
    })
    const parsed = JSON.parse(result)
    Object.keys(parsed).forEach(path => {
      expect(path).not.toMatch(/\.test\.ts$/)
    })
  })

  test('should handle invalid path', async () => {
    const result = await tool.invoke({
      requestType: 'file',
      paths: ['nonexistent/file.txt'],
    })
    const parsed = JSON.parse(result)
    expect(parsed['nonexistent/file.txt']).toHaveProperty('error')
  })

  test('should handle empty paths array', async () => {
    await expect(
      tool.invoke({
        requestType: 'files',
        paths: [],
      })
    ).rejects.toThrow()
  })

  test('should handle invalid request type', async () => {
    // @ts-expect-error Testing invalid request type
    await expect(tool.invoke({ requestType: 'invalid', paths: [] })).rejects.toThrow()
  })
})
