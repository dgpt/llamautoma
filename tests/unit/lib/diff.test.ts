import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { generateDiffs, generateCompressedDiffs } from '@/lib/diff'
import type { File } from '@/ai/tools/schemas/file'
import { logger } from '@/logger'
import { mockStream, setTestMode, resetTestMode } from '@/tests/mocks/stream'

describe('Diff Library', () => {
  beforeEach(() => {
    logger.debug('Setting up test...')
    mockStream.clearMocks()
    setTestMode()
    logger.debug('Test setup complete')
  })

  afterEach(() => {
    logger.debug('Cleaning up test...')
    mockStream.clearMocks()
    resetTestMode()
    logger.debug('Test cleanup complete')
  })

  describe('generateDiffs', () => {
    test('should generate diff for file modifications', async () => {
      logger.debug('Starting file modification test')
      // Mock original file
      const originalContent = `
import React from 'react';
export const Counter = () => {
  let count = 0;
  const increment = () => count++;
  const decrement = () => count--;
  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`

      const newContent = `
import React, { useState } from 'react';
export const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count - 1)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
};`

      logger.debug('Mocking file in test system')
      mockStream.mockFile('src/components/Counter.tsx', originalContent)
      logger.debug('File mocked successfully')

      // Create input for diff generation
      logger.debug('Creating diff input')
      const files: File[] = [
        {
          path: 'src/components/Counter.tsx',
          content: newContent,
          type: 'update',
        },
      ]
      logger.debug(`Created diff input: ${JSON.stringify(files)}`)

      logger.debug('Calling generateDiffs')
      const diffs = await generateDiffs(files)
      logger.debug(`Got diffs: ${JSON.stringify(diffs)}`)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/components/Counter.tsx')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // Each diff entry should be a tuple of [operation, content]
      diffs[0].diff.forEach(entry => {
        expect(entry).toBeArray()
        expect(entry).toHaveLength(2)
        expect(entry[0]).toBeNumber()
        expect(entry[1]).toBeString()
      })

      // Verify some key changes are present
      const diffText = diffs[0].diff.map(([_, text]) => text).join('')
      expect(diffText).toInclude('useState')
      expect(diffText).toInclude('setCount')
      logger.debug('Test completed successfully')
    })

    test('should handle new file creation', async () => {
      const newContent = 'const x = 2;'

      // Don't mock the original file since it's a new file
      const files: File[] = [
        {
          path: 'src/newfile.ts',
          content: newContent,
          type: 'create',
        },
      ]

      const diffs = await generateDiffs(files)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/newfile.ts')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // For new files, everything should be marked as added
      const diffText = diffs[0].diff.map(([op, text]) => text).join('')
      expect(diffText).toBe(newContent)

      // Verify the diff operations - should only have additions
      const ops = diffs[0].diff.map(([op, _]) => op)
      expect(ops).toEqual([1]) // Only additions for new files
    })
  })

  describe('generateCompressedDiffs', () => {
    test('should generate and compress diffs', async () => {
      const originalContent = 'const x = 1;'
      const newContent = 'const x = 12;'

      logger.debug('Mocking file in test system')
      mockStream.mockFile('src/test.ts', originalContent)
      logger.debug('File mocked successfully')

      const files: File[] = [
        {
          path: 'src/test.ts',
          content: newContent,
          type: 'update',
        },
      ]

      logger.debug('Calling generateCompressedDiffs')
      const diffs = await generateCompressedDiffs(files)
      logger.debug(`Got diffs: ${JSON.stringify(diffs)}`)

      expect(diffs).toBeArray()
      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toHaveProperty('path', 'src/test.ts')
      expect(diffs[0]).toHaveProperty('diff')
      expect(diffs[0].diff).toBeArray()

      // Verify diff shows the change from 1 to 12
      const diffText = diffs[0].diff.map(([op, text]) => text).join('')
      logger.debug(`Diff text: ${diffText}`)
      expect(diffText).toInclude('const x = 1')
      expect(diffText).toInclude('const x = 12')

      // Verify the diff operations
      const ops = diffs[0].diff.map(([op, _]) => op)
      logger.debug(`Diff operations: ${JSON.stringify(ops)}`)
      expect(ops).toContain(-1) // Deletion
      expect(ops).toContain(1) // Addition
    })
  })
})
