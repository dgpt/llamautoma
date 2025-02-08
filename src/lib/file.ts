import { streamHandler } from '../stream'
import { logger } from '@/logger'
import type { FileOp } from 'llamautoma-types'
import { decodeAndDecompressMessage } from '@/lib/compression'

/**
 * Core function to get files from the client
 * Basic file operations only - compression/encoding handled at higher levels
 */
export async function getFiles(
  paths: string[],
  includePattern?: string,
  excludePattern?: string
): Promise<{ [path: string]: string }> {
  try {
    // Format request for client
    const clientRequest = {
      type: 'file_request',
      data: {
        requestType: paths.length === 1 ? 'file' : 'files',
        paths,
        includePattern,
        excludePattern,
      },
    }

    // Send request to client
    streamHandler.sendResponse('file', JSON.stringify(clientRequest))
    logger.debug(`Sent file request: ${JSON.stringify(clientRequest)}`)

    // Collect file chunks
    const files: { [path: string]: FileOp } = {}

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        logger.error('File request timeout')
        reject(new Error('File request timeout'))
      }, 30000) // 30 second timeout

      const onData = (data: any) => {
        try {
          logger.debug(`Raw data: ${data.toString()}`)
          const response = decodeAndDecompressMessage(data)
          logger.debug(`Decoded response: ${JSON.stringify(response)}`)

          switch (response.type) {
            case 'response': {
              logger.debug(`Response content: ${response.content}`)
              const fileResponse = JSON.parse(response.content)
              if (fileResponse.type === 'file_chunk') {
                const { path, content, error } = fileResponse.data
                logger.debug(`Received file chunk for ${path}`)

                // Initialize file entry if needed
                if (!files[path]) {
                  files[path] = { path, content: '' }
                }

                // Handle error
                if (error) {
                  files[path].error = error
                  return
                }

                // Add content directly
                const fileEntry = files[path] as FileOp & { content: string }
                if (fileEntry) {
                  fileEntry.content = content
                  logger.debug(`Added content for ${path}`)
                }
              }
              break
            }

            case 'complete':
              logger.debug(`File operation complete: ${JSON.stringify(files)}`)
              cleanup()
              resolve(files)
              break

            case 'error':
              logger.error(`Received error response: ${response.error}`)
              cleanup()
              reject(new Error(response.error))
              break
          }
        } catch (error) {
          logger.error(`Failed to process file response: ${error}`)
          cleanup()
          reject(error)
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        streamHandler.off('data', onData)
        logger.debug('Cleaned up file response handler')
      }

      streamHandler.on('data', onData)
      logger.debug('Registered file response handler')
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`File operation error: ${message}`)
    throw new Error(`Failed to read files: ${message}`)
  }
}
