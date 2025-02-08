import type { FileOp } from 'llamautoma-types'

/**
 * Mock file system for tests
 */
class MockFileSystem {
  private mockFiles = new Map<string, string>()

  /**
   * Mock file content for tests
   */
  async mockFile(path: string, content: string): Promise<void> {
    this.mockFiles.set(path, content)
  }

  /**
   * Get mock file content
   */
  async getFile(path: string): Promise<FileOp> {
    const content = this.mockFiles.get(path)
    if (!content) {
      return {
        path,
        error: `File not found: ${path}`,
      }
    }

    return {
      path,
      content,
    }
  }

  /**
   * Get multiple mock files
   */
  async getFiles(paths: string[]): Promise<{ [path: string]: FileOp }> {
    const files: { [path: string]: FileOp } = {}
    await Promise.all(
      paths.map(async path => {
        files[path] = await this.getFile(path)
      })
    )
    return files
  }

  /**
   * Clear mock file system
   */
  clearMocks(): void {
    this.mockFiles.clear()
  }
}

export const mockFiles = new MockFileSystem()
