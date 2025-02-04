import pino from 'pino'

// Configure logger with minimal, focused formatting
export const logger = pino({
  name: 'llamautoma',
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname,name',
      messageFormat: '{msg}',
      levelFirst: false,
    },
  },
  formatters: {
    level: label => {
      return { level: label.toUpperCase() }
    },
  },
})

// Performance tracking
const timers = new Map<string, number>()

export const startTimer = (id: string) => {
  timers.set(id, performance.now())
}

export const endTimer = (id: string): number | undefined => {
  const start = timers.get(id)
  if (start) {
    timers.delete(id)
    return Math.round(performance.now() - start)
  }
  return undefined
}

// Focused logging functions
export const logUserInput = (threadId: string, content: string) => {
  logger.info({ threadId }, `📤 User Input: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`)
}

export const logAgentResponse = (threadId: string, type: string, content: string, elapsedMs?: number) => {
  const timing = elapsedMs ? ` (${elapsedMs}ms)` : ''
  logger.info(
    { threadId },
    `📥 Agent Response [${type}]${timing}: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`
  )
}

export const logRequest = (threadId: string, method: string, url: string, body?: any) => {
  logger.info({ threadId }, `🌐 Request ${method} ${url}${body ? ` Body: ${JSON.stringify(body).slice(0, 100)}...` : ''}`)
}

export const logResponse = (threadId: string, url: string, status: number, elapsedMs: number) => {
  logger.info({ threadId }, `🌐 Response ${url} [${status}] (${elapsedMs}ms)`)
}

export const logStreamData = (threadId: string, data: any) => {
  logger.info({ threadId }, `📡 Stream Data: ${JSON.stringify(data).slice(0, 100)}...`)
}

export const logError = (threadId: string, error: Error | string, context?: any) => {
  logger.error({ threadId, ...(context || {}) }, `❌ Error: ${error instanceof Error ? error.message : error}`)
}
