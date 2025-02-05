import { expect, test, describe, beforeAll } from 'bun:test'
import { DiffTool } from '@/ai/tools/diff'
import { mock, Mock } from 'bun:test'
import { waitForClientResponse } from '@/ai/utils/stream'

// Mock the stream module
mock.module('@/ai/utils/stream', () => ({
  streamToClient: async () => {},
  waitForClientResponse: mock(() => Promise.resolve()),
}))

describe('DiffTool', () => {
  let diffTool: DiffTool
  let mockWaitForResponse: Mock<typeof waitForClientResponse>

  beforeAll(() => {
    diffTool = new DiffTool()
    mockWaitForResponse = mock(waitForClientResponse)
  })

  test('should generate diff for new file', async () => {
    // Mock stream responses for a non-existent file
    mockWaitForResponse
      .mockResolvedValueOnce({
        type: 'file_chunk',
        data: {
          path: 'test.ts',
          chunk: '',
          done: true,
          error: 'File not found',
        },
      })
      .mockResolvedValueOnce({
        type: 'file_complete',
      })

    const input = {
      files: [
        {
          path: 'test.ts',
          content: 'console.log("Hello World")',
          language: 'typescript',
        },
      ],
    }

    const result = await diffTool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toHaveProperty('path', 'test.ts')
    expect(parsed[0]).toHaveProperty('diff')
    expect(parsed[0].diff).toEqual([[1, 'console.log("Hello World")']])
  })

  test('should generate diff for modified file', async () => {
    // Mock stream responses for an existing file
    mockWaitForResponse
      .mockResolvedValueOnce({
        type: 'file_chunk',
        data: {
          path: 'test.ts',
          chunk: 'console.log("Hello")',
          done: true,
        },
      })
      .mockResolvedValueOnce({
        type: 'file_complete',
      })

    const input = {
      files: [
        {
          path: 'test.ts',
          content: 'console.log("Hello World")',
          language: 'typescript',
        },
      ],
    }

    const result = await diffTool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toHaveProperty('path', 'test.ts')
    expect(parsed[0]).toHaveProperty('diff')
    // The diff should show the change from "Hello" to "Hello World"
    expect(parsed[0].diff).toEqual([
      [0, 'console.log("Hello'],
      [1, ' World'],
      [0, '")'],
    ])
  })

  test('should handle multiple files', async () => {
    // Mock stream responses for multiple files
    mockWaitForResponse
      .mockResolvedValueOnce({
        type: 'file_chunk',
        data: {
          path: 'test1.ts',
          chunk: 'console.log("Hello")',
          done: true,
        },
      })
      .mockResolvedValueOnce({
        type: 'file_chunk',
        data: {
          path: 'test2.ts',
          chunk: '',
          done: true,
          error: 'File not found',
        },
      })
      .mockResolvedValueOnce({
        type: 'file_complete',
      })

    const input = {
      files: [
        {
          path: 'test1.ts',
          content: 'console.log("Hello World")',
          language: 'typescript',
        },
        {
          path: 'test2.ts',
          content: 'console.log("New file")',
          language: 'typescript',
        },
      ],
    }

    const result = await diffTool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toHaveProperty('path', 'test1.ts')
    expect(parsed[1]).toHaveProperty('path', 'test2.ts')
    expect(parsed[1]).toHaveProperty('error')
  })

  test('should handle stream errors', async () => {
    // Mock stream error response
    mockWaitForResponse.mockResolvedValueOnce({
      type: 'error',
      error: 'Failed to read files',
    })

    const input = {
      files: [
        {
          path: 'test.ts',
          content: 'console.log("Hello")',
          language: 'typescript',
        },
      ],
    }

    await expect(diffTool.call(input)).rejects.toThrow('Failed to generate diff')
  })
})
