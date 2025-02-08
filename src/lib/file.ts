import { logger } from '@/logger'
import { createStreamResponse, readClientStream } from '@/stream'
import type { StreamMessage } from '@/stream'
import { DEFAULT_AGENT_CONFIG } from '@/types'

/**
 * Get file content from client
 * Returns compressed and encoded file content
 */
export async function getFile(path: string, config = DEFAULT_AGENT_CONFIG): Promise<string> {
  try {
    // Create request message
    const request: StreamMessage = {
      type: 'edit',
      data: {
        path,
        action: 'read',
      },
    }

    // Create response stream
    const response = createStreamResponse({
      async *[Symbol.asyncIterator]() {
        yield request
      },
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Failed to create stream reader')

    // Create response promise
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reader.releaseLock()
        reject(new Error('File request timeout'))
      }, config.userInputTimeout)

      // Read response stream
      readClientStream(reader)
        .next()
        .then(({ value, done }) => {
          clearTimeout(timeout)
          if (done) {
            reject(new Error('Stream ended without response'))
            return
          }

          if (value?.type === 'edit' && typeof value.data === 'object' && value.data !== null) {
            const { content, error } = value.data as {
              content?: string
              error?: string
            }

            if (error) {
              logger.error(`Error reading file ${path}: ${error}`)
              reject(new Error(error))
              return
            }

            if (content) {
              resolve(content)
              return
            }

            reject(new Error('Response missing both content and error'))
            return
          }

          reject(new Error('Invalid response type'))
        })
        .catch(error => {
          clearTimeout(timeout)
          logger.error(`Failed to process file response: ${error}`)
          reject(error)
        })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`File operation error: ${message}`)
    throw new Error(`Failed to read file: ${message}`)
  }
}
