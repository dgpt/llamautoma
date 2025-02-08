import { EventEmitter } from 'node:events'
import { logger } from '@/logger'

/**
 * Mock stream handler for tests
 */
export class MockStreamHandler extends EventEmitter {
  private mockFileSystem = new Map<string, string>()

  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * Mock streaming request to client
   */
  async streamToClient(request: any): Promise<void> {
    try {
      // Store request in mock file system
      this.mockFileSystem.set('lastRequest', JSON.stringify(request))

      // For file requests, emit mock file response
      if (request.type === 'file_request') {
        const { paths } = request.data
        for (const path of paths) {
          const content = this.mockFileSystem.get(path)
          if (content) {
            // Emit file chunk event
            this.emit(
              'data',
              JSON.stringify({
                type: 'file_chunk',
                data: {
                  path,
                  chunk: content,
                  done: true,
                },
              })
            )
          }
        }
      }

      // Always emit complete event
      this.emit(
        'data',
        JSON.stringify({
          type: 'file_complete',
        })
      )
    } catch (error) {
      logger.error({ error }, 'Mock stream error')
      throw error
    }
  }

  /**
   * Mock waiting for client response
   */
  async waitForClientResponse<T>(): Promise<T> {
    return new Promise(resolve => {
      // Get the last request
      const lastRequest = this.mockFileSystem.get('lastRequest')
      if (!lastRequest) {
        resolve({
          type: 'file_complete',
        } as T)
        return
      }

      try {
        const request = JSON.parse(lastRequest)
        if (request.type === 'file_request') {
          const { paths } = request.data
          const files: Record<string, { path: string; content: string }> = {}

          // Collect all requested files
          for (const path of paths) {
            const content = this.mockFileSystem.get(path)
            if (content) {
              files[path] = { path, content }
            }
          }

          // Return file chunk response
          if (Object.keys(files).length > 0) {
            resolve({
              type: 'file_chunk',
              data: {
                path: paths[0],
                chunk: files[paths[0]].content,
                done: true,
              },
            } as T)
          } else {
            resolve({
              type: 'file_complete',
            } as T)
          }
        } else {
          resolve({
            type: 'file_complete',
          } as T)
        }
      } catch (error) {
        logger.error({ error }, 'Failed to parse last request')
        resolve({
          type: 'file_complete',
        } as T)
      }
    })
  }

  /**
   * Mock file content for tests
   */
  mockFile(path: string, content: string): void {
    this.mockFileSystem.set(path, content)
  }

  /**
   * Clear mock file system
   */
  clearMocks(): void {
    this.mockFileSystem.clear()
  }
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()
