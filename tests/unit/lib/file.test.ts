import { expect, test, describe } from 'bun:test'
import { getFiles } from '@/lib/file'
import { mockStream } from '@/tests/mocks/stream'
import { logger } from '@/logger'
import type { StreamEvent } from '@/types/stream'

// Increase test timeout
const TEST_TIMEOUT = 10000

// Types for file streaming
interface FileRequest {
  type: 'file_request'
  data: {
    requestType: 'file' | 'files' | 'directory' | 'directories'
    paths: string[]
    includePattern?: string
    excludePattern?: string
  }
}

describe('File Library', () => {
  describe('getFiles', () => {
    test(
      'should get single file',
      async () => {
        logger.debug('Starting single file test')
        const content = 'test file content'
        mockStream.mockFile('src/components/Counter.tsx', content)

        const files = await getFiles(['src/components/Counter.tsx'])
        const fileOp = files['src/components/Counter.tsx']

        expect(fileOp).toBeDefined()
        expect(fileOp.error).toBeUndefined()
        expect(fileOp.content).toBeDefined()
        expect(fileOp.content).toBe(content)
        logger.debug('Single file test completed')
      },
      TEST_TIMEOUT
    )

    test(
      'should get multiple files',
      async () => {
        logger.debug('Starting multiple files test')
        const files = {
          'src/components/Counter.tsx': 'content 1',
          'src/components/App.tsx': 'content 2',
        }
        for (const [path, content] of Object.entries(files)) {
          mockStream.mockFile(path, content)
        }

        const result = await getFiles(Object.keys(files))

        // Verify each file's content
        for (const [path, content] of Object.entries(files)) {
          const fileOp = result[path]
          expect(fileOp).toBeDefined()
          expect(fileOp.error).toBeUndefined()
          expect(fileOp.content).toBe(content)
        }
        logger.debug('Multiple files test completed')
      },
      TEST_TIMEOUT
    )

    test(
      'should handle missing files',
      async () => {
        logger.debug('Starting missing file test')
        const files = await getFiles(['nonexistent.ts'])
        expect(files['nonexistent.ts']).toEqual({
          path: 'nonexistent.ts',
          content: '',
          error: 'File not found: nonexistent.ts',
        })
        logger.debug('Missing file test completed')
      },
      TEST_TIMEOUT
    )

    test(
      'should handle invalid response data',
      async () => {
        logger.debug('Starting invalid response test')
        // Mock emitCompressed to emit invalid data
        mockStream.emitCompressed = () => {
          mockStream.emit('data', 'invalid')
        }

        await expect(getFiles(['test.ts'])).rejects.toThrow()
        logger.debug('Invalid response test completed')
      },
      TEST_TIMEOUT
    )

    test(
      'should handle error response',
      async () => {
        logger.debug('Starting error response test')
        // Mock emitCompressed to emit error
        mockStream.emitCompressed = () => {
          const errorEvent: StreamEvent = {
            type: 'error',
            task: 'file',
            error: 'Test error',
            timestamp: Date.now(),
          }
          mockStream.emit('data', errorEvent)
        }

        await expect(getFiles(['test.ts'])).rejects.toThrow('Test error')
        logger.debug('Error response test completed')
      },
      TEST_TIMEOUT
    )

    test(
      'should handle include/exclude patterns',
      async () => {
        logger.debug('Starting pattern test')
        const files = {
          'src/components/Counter.tsx': 'content 1',
          'src/components/App.tsx': 'content 2',
          'src/components/test.spec.ts': 'test content',
        }
        for (const [path, content] of Object.entries(files)) {
          mockStream.mockFile(path, content)
        }

        const result = await getFiles(Object.keys(files), '*.tsx')

        // Should only include .tsx files
        expect(Object.keys(result)).toHaveLength(2)
        expect(result['src/components/Counter.tsx']).toBeDefined()
        expect(result['src/components/App.tsx']).toBeDefined()
        expect(result['src/components/test.spec.ts']).toBeUndefined()

        // Verify content of included files
        expect(result['src/components/Counter.tsx'].content).toBe('content 1')
        expect(result['src/components/App.tsx'].content).toBe('content 2')
        logger.debug('Pattern test completed')
      },
      TEST_TIMEOUT
    )
  })
})
