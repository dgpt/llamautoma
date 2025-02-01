import pino from 'pino'

// Configure logger with consistent formatting
export const logger = pino({
  name: 'llamautoma',
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      messageFormat: '{msg} {context}',
      levelFirst: true,
    },
  },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
})
