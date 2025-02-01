import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { logger } from './logger'

export class FileSystemSync {
  async readFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8')
    } catch (error) {
      logger.error({ error, path }, 'Failed to read file')
      throw error
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await fs.mkdir(dirname(path), { recursive: true })
      await fs.writeFile(path, content, 'utf-8')
    } catch (error) {
      logger.error({ error, path }, 'Failed to write file')
      throw error
    }
  }

  async listFiles(path: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(path, { withFileTypes: true })
      return entries
        .filter(entry => entry.isFile())
        .map(entry => join(path, entry.name))
    } catch (error) {
      logger.error({ error, path }, 'Failed to list files')
      throw error
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await fs.unlink(path)
    } catch (error) {
      logger.error({ error, path }, 'Failed to delete file')
      throw error
    }
  }
}