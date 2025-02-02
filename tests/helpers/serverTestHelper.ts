import { Server } from '../../src/server'
import { logger } from '../../src/utils/logger'

export interface ServerRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: any
}

export class ServerTestHelper {
  private static instance: ServerTestHelper
  private server: Server | null = null

  private constructor() {}

  static getInstance(): ServerTestHelper {
    if (!ServerTestHelper.instance) {
      ServerTestHelper.instance = new ServerTestHelper()
    }
    return ServerTestHelper.instance
  }

  setServer(server: Server) {
    this.server = server
  }

  async makeRequest(path: string, options: ServerRequestOptions = {}): Promise<Response> {
    if (!this.server) {
      throw new Error('Server not initialized')
    }

    const bunServer = this.server.getServer()
    if (!bunServer) {
      throw new Error('Bun server not initialized')
    }

    const { method = 'POST', headers = {}, body } = options

    const request = new Request(`http://localhost:3001${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    })

    logger.trace({ path, method }, 'Making server request')
    return bunServer.fetch(request)
  }

  async readStreamWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    try {
      const result = await reader.read()
      if (!result || result.done) {
        return ''
      }

      const value = result.value as Uint8Array
      const text = new TextDecoder().decode(value)

      // Only return actual SSE data lines
      const lines = text.split('\n')
      const dataLines = lines
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice(6)) // Remove 'data: ' prefix

      return dataLines.join('\n')
    } catch (error) {
      logger.error(`Stream read error: ${error?.constructor.name}`)
      throw error
    }
  }
}