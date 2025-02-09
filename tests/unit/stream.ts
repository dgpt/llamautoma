import { EventEmitter } from 'node:events'
import { logger } from '@/logger'
import { ServerMessage, ClientMessage } from '@/stream'

// Type for file request data
type FileRequestData = {
  type: 'file_request'
  paths: string[]
}

/**
 * Mock stream handler for tests
 */
export class MockStreamHandler extends EventEmitter {
  private mockFileSystem = new Map<string, string>()
  private mockCallbacks: ((message: ServerMessage) => void)[] = []

  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * Mock streaming request to client
   */
  async streamToClient(request: ClientMessage): Promise<void> {
    try {
      // Store request in mock file system
      this.mockFileSystem.set('lastRequest', JSON.stringify(request))

      // For file requests, emit mock file response
      const data = request.data as FileRequestData
      if (request.type === 'input' && data?.type === 'file_request') {
        const { paths } = data
        for (const path of paths) {
          const content = this.mockFileSystem.get(path)
          if (content) {
            // Emit file chunk event
            this.emit('data', {
              type: 'edit',
              content,
              metadata: { path },
              timestamp: Date.now(),
            } as ServerMessage)
          }
        }
      }

      // Always emit complete event
      this.emit('data', {
        type: 'status',
        content: 'Complete',
        timestamp: Date.now(),
      } as ServerMessage)
    } catch (error) {
      logger.error({ error }, 'Mock stream error')
      throw error
    }
  }

  /**
   * Mock waiting for client response
   */
  async waitForClientResponse(): Promise<ServerMessage> {
    return new Promise(resolve => {
      // Get the last request
      const lastRequest = this.mockFileSystem.get('lastRequest')
      if (!lastRequest) {
        resolve({
          type: 'status',
          content: 'Complete',
          timestamp: Date.now(),
        })
        return
      }

      try {
        const request = JSON.parse(lastRequest) as ClientMessage
        const data = request.data as FileRequestData
        if (request.type === 'input' && data?.type === 'file_request') {
          const { paths } = data
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
              type: 'edit',
              content: files[paths[0]].content,
              metadata: { path: paths[0] },
              timestamp: Date.now(),
            })
          } else {
            resolve({
              type: 'status',
              content: 'Complete',
              timestamp: Date.now(),
            })
          }
        } else {
          resolve({
            type: 'status',
            content: 'Complete',
            timestamp: Date.now(),
          })
        }
      } catch (error) {
        logger.error({ error }, 'Failed to parse last request')
        resolve({
          type: 'status',
          content: 'Complete',
          timestamp: Date.now(),
        })
      }
    })
  }

  /**
   * Mock callback registration
   */
  onMessage(callback: (message: ServerMessage) => void): void {
    this.mockCallbacks.push(callback)
  }

  /**
   * Mock callback removal
   */
  offMessage(callback: (message: ServerMessage) => void): void {
    this.mockCallbacks = this.mockCallbacks.filter(cb => cb !== callback)
  }

  /**
   * Mock sending message to callbacks
   */
  send(message: ServerMessage): void {
    for (const callback of this.mockCallbacks) {
      try {
        callback(message)
      } catch (error) {
        logger.error('Mock callback error:', error)
      }
    }
  }

  /**
   * Mock file content for tests
   */
  mockFile(path: string, content: string): void {
    this.mockFileSystem.set(path, content)
  }

  /**
   * Clear mock file system and callbacks
   */
  clearMocks(): void {
    this.mockFileSystem.clear()
    this.mockCallbacks = []
  }
}

// Export singleton instance for tests
export const mockStream = new MockStreamHandler()
