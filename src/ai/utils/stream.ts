import { EventEmitter } from 'events'
import { logger } from '@/logger'

// Global event emitter for client-server communication
const clientStream = new EventEmitter()

/**
 * Stream data to the client
 */
export async function streamToClient(data: unknown): Promise<void> {
  try {
    const message = {
      type: 'request',
      data,
    }

    // Log outgoing request
    logger.debug({ message }, 'Streaming request to client')

    // Emit to client
    clientStream.emit('data', JSON.stringify(message))
  } catch (error) {
    logger.error({ error }, 'Failed to stream request to client')
    throw error
  }
}

/**
 * Wait for client response
 */
export async function waitForClientResponse<T>(): Promise<T | null> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      cleanup()
      logger.warn('Client response timeout')
      resolve(null)
    }, 30000) // 30 second timeout

    const onResponse = (data: string) => {
      try {
        const response = JSON.parse(data)
        cleanup()
        logger.debug({ response }, 'Received client response')
        resolve(response as T)
      } catch (error) {
        logger.error({ error, data }, 'Failed to parse client response')
        cleanup()
        resolve(null)
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      clientStream.off('response', onResponse)
    }

    clientStream.once('response', onResponse)
  })
}

// Export event emitter for use in server setup
export { clientStream }
