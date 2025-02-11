import { logger } from '@/logger'
import { broadcast, onInboundMessage } from '@/stream'
import type { ServerToClientMessage, ClientToServerMessage } from '@/stream'
import { DEFAULT_CONFIG } from '@/config'
import { decompressAndDecodeFile } from '@/lib/compression'

/**
 * Get file content from client
 * Returns compressed and encoded file content
 */
export async function getFile(path: string, config = DEFAULT_CONFIG): Promise<string> {
  const request: ServerToClientMessage = {
    type: 'edit',
    data: {
      path,
      action: 'read',
    },
    timestamp: Date.now(),
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    let isHandled = false

    const setupTimeout = () => {
      timeoutId = setTimeout(() => {
        if (!isHandled) {
          isHandled = true
          if (unsubscribe) unsubscribe()
          reject(new Error('File request timeout'))
        }
      }, config.timeout)
    }

    unsubscribe = onInboundMessage(async (message: ClientToServerMessage) => {
      if (message.type !== 'input' || isHandled) return

      const response = message.data
      if (typeof response !== 'object' || response === null) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error('Invalid response format'))
        return
      }

      const { content, error } = response as {
        content?: string
        error?: string
      }

      if (error) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error(error))
        return
      }

      if (content) {
        try {
          const decompressedContent = await decompressAndDecodeFile(content)
          isHandled = true
          if (timeoutId) clearTimeout(timeoutId)
          if (unsubscribe) unsubscribe()
          resolve(decompressedContent)
          return
        } catch (error) {
          isHandled = true
          if (timeoutId) clearTimeout(timeoutId)
          if (unsubscribe) unsubscribe()
          reject(new Error('Invalid response format'))
          return
        }
      }

      isHandled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (unsubscribe) unsubscribe()
      reject(new Error('Response missing both content and error'))
    })

    setupTimeout()
    broadcast(request).catch(error => {
      if (!isHandled) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error(`Failed to read file: ${error.message}`))
      }
    })
  })
}

/**
 * Get directory contents from client
 * Returns a map of file paths to their contents
 */
export async function getDirectory(
  path: string,
  config = DEFAULT_CONFIG,
  includePattern?: string,
  excludePattern?: string
): Promise<Record<string, string>> {
  const request: ServerToClientMessage = {
    type: 'edit',
    data: {
      path,
      action: 'readdir',
      includePattern,
      excludePattern,
    },
    timestamp: Date.now(),
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    let isHandled = false

    const setupTimeout = () => {
      timeoutId = setTimeout(() => {
        if (!isHandled) {
          isHandled = true
          if (unsubscribe) unsubscribe()
          reject(new Error('Directory request timeout'))
        }
      }, config.timeout)
    }

    unsubscribe = onInboundMessage(async (message: ClientToServerMessage) => {
      if (message.type !== 'input' || isHandled) return

      const response = message.data
      if (typeof response !== 'object' || response === null) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error('Invalid response format'))
        return
      }

      const { files, error, content } = response as {
        files?: Record<string, string> | unknown
        error?: string
        content?: unknown
      }

      if (error) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error(error))
        return
      }

      // Reject if content or files exist but are not in the expected format
      if (content !== undefined || (files !== undefined && typeof files !== 'object')) {
        logger.debug('Rejecting due to invalid format:', { content, files })
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error('Invalid response format'))
        return
      }

      if (files && typeof files === 'object') {
        try {
          const decompressedFiles = Object.fromEntries(
            await Promise.all(
              Object.entries(files).map(async ([path, content]) => [
                path,
                await decompressAndDecodeFile(content),
              ])
            )
          )
          isHandled = true
          if (timeoutId) clearTimeout(timeoutId)
          if (unsubscribe) unsubscribe()
          resolve(decompressedFiles)
          return
        } catch (error) {
          isHandled = true
          if (timeoutId) clearTimeout(timeoutId)
          if (unsubscribe) unsubscribe()
          reject(new Error('Invalid response format'))
          return
        }
      }

      isHandled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (unsubscribe) unsubscribe()
      reject(new Error('Response missing both files and error'))
    })

    setupTimeout()
    broadcast(request).catch(error => {
      if (!isHandled) {
        isHandled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (unsubscribe) unsubscribe()
        reject(new Error(`Failed to read directory: ${error.message}`))
      }
    })
  })
}
