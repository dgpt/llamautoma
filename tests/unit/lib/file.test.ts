import { expect, test, describe, spyOn, beforeEach, afterEach } from 'bun:test'
import { getFile, getDirectory } from '@/lib/file'
import * as stream from '@/stream'
import * as compression from '@/lib/compression'
import { DEFAULT_CONFIG } from '@/config'
import type { ClientToServerMessage } from '@/stream'

describe('File Library', () => {
  // Mock dependencies
  let broadcastSpy: ReturnType<typeof spyOn>
  let onInboundMessageSpy: ReturnType<typeof spyOn>
  let decompressAndDecodeFileSpy: ReturnType<typeof spyOn>
  let unsubscribeMock: () => void

  beforeEach(() => {
    // Mock stream functions
    broadcastSpy = spyOn(stream, 'broadcast')
    onInboundMessageSpy = spyOn(stream, 'onInboundMessage')

    // Mock compression
    decompressAndDecodeFileSpy = spyOn(compression, 'decompressAndDecodeFile')

    // Setup default mocks
    unsubscribeMock = () => {}
    onInboundMessageSpy.mockImplementation((handler: (message: ClientToServerMessage) => void) => {
      setTimeout(() => {
        handler({
          type: 'input',
          data: { content: '~test content' },
          timestamp: Date.now(),
        })
      }, 0)
      return unsubscribeMock
    })

    broadcastSpy.mockImplementation(() => Promise.resolve())
    decompressAndDecodeFileSpy.mockImplementation(async (content: string) =>
      content.startsWith('~') ? content.slice(1) : content
    )
  })

  afterEach(() => {
    broadcastSpy.mockRestore()
    onInboundMessageSpy.mockRestore()
    decompressAndDecodeFileSpy.mockRestore()
  })

  describe('getFile', () => {
    test('should get file content successfully', async () => {
      const content = await getFile('test.ts')

      expect(content).toBe('test content')
      expect(broadcastSpy).toHaveBeenCalledWith({
        type: 'edit',
        data: {
          path: 'test.ts',
          action: 'read',
        },
        timestamp: expect.any(Number),
      })
    })

    test('should handle broadcast errors', async () => {
      broadcastSpy.mockImplementation(() => Promise.reject(new Error('Broadcast failed')))

      await expect(getFile('test.ts')).rejects.toThrow('Failed to read file: Broadcast failed')
    })

    test('should handle timeout', async () => {
      onInboundMessageSpy.mockImplementation(() => unsubscribeMock)

      await expect(getFile('test.ts', { ...DEFAULT_CONFIG, timeout: 1 })).rejects.toThrow(
        'File request timeout'
      )
    })

    test('should handle invalid response format', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: 'invalid',
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getFile('test.ts')).rejects.toThrow('Invalid response format')
    })

    test('should handle error in response', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: { error: 'File not found' },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getFile('test.ts')).rejects.toThrow('File not found')
    })

    test('should handle missing content and error', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: {},
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getFile('test.ts')).rejects.toThrow('Response missing both content and error')
    })

    test('should handle decompression errors', async () => {
      decompressAndDecodeFileSpy.mockImplementation(() =>
        Promise.reject(new Error('Decompression failed'))
      )

      await expect(getFile('test.ts')).rejects.toThrow('Invalid response format')
    })
  })

  describe('getDirectory', () => {
    test('should get directory contents successfully', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: {
                files: {
                  'test1.ts': '~content1',
                  'test2.ts': '~content2',
                },
              },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      const files = await getDirectory('src')

      expect(files).toEqual({
        'test1.ts': 'content1',
        'test2.ts': 'content2',
      })
      expect(broadcastSpy).toHaveBeenCalledWith({
        type: 'edit',
        data: {
          path: 'src',
          action: 'readdir',
          includePattern: undefined,
          excludePattern: undefined,
        },
        timestamp: expect.any(Number),
      })
    })

    test('should handle broadcast errors', async () => {
      broadcastSpy.mockImplementation(() => Promise.reject(new Error('Broadcast failed')))

      await expect(getDirectory('src')).rejects.toThrow(
        'Failed to read directory: Broadcast failed'
      )
    })

    test('should handle timeout', async () => {
      onInboundMessageSpy.mockImplementation(() => unsubscribeMock)

      await expect(getDirectory('src', { ...DEFAULT_CONFIG, timeout: 1 })).rejects.toThrow(
        'Directory request timeout'
      )
    })

    test('should handle invalid response format', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: 'invalid',
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getDirectory('src')).rejects.toThrow('Invalid response format')
    })

    test('should handle error in response', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: { error: 'Directory not found' },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getDirectory('src')).rejects.toThrow('Directory not found')
    })

    test('should handle invalid files format', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: { files: 'invalid' },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getDirectory('src')).rejects.toThrow('Invalid response format')
    })

    test('should handle missing files and error', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: {},
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getDirectory('src')).rejects.toThrow('Response missing both files and error')
    })

    test('should handle decompression errors', async () => {
      decompressAndDecodeFileSpy.mockImplementation(() =>
        Promise.reject(new Error('Decompression failed'))
      )

      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: {
                files: {
                  'test.ts': '~invalid',
                },
              },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      await expect(getDirectory('src')).rejects.toThrow('Invalid response format')
    })

    test('should handle include/exclude patterns', async () => {
      onInboundMessageSpy.mockImplementation(
        (handler: (message: ClientToServerMessage) => void) => {
          setTimeout(() => {
            handler({
              type: 'input',
              data: {
                files: {
                  'test.ts': '~content',
                },
              },
              timestamp: Date.now(),
            })
          }, 0)
          return unsubscribeMock
        }
      )

      const files = await getDirectory('src', DEFAULT_CONFIG, '*.ts', '*.test.ts')

      expect(broadcastSpy).toHaveBeenCalledWith({
        type: 'edit',
        data: {
          path: 'src',
          action: 'readdir',
          includePattern: '*.ts',
          excludePattern: '*.test.ts',
        },
        timestamp: expect.any(Number),
      })
    })
  })
})
