import { ChatOllama } from '@langchain/ollama'
import { ReActAgent } from './agents/react/agent'
import { MemoryManager } from './agents/react/memory/memoryManager'
import { FileSystemTool } from './agents/react/tools/fileSystemTool'
import { Server } from './server'
import { logger } from './utils/logger'
import { MemorySaver } from '@langchain/langgraph'

async function main() {
  try {
    // Initialize chat model
    const chat = new ChatOllama({
      model: 'qwen2.5-coder:7b',
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
    })

    // Initialize memory and tools
    const memory = new MemoryManager()
    const fileSystemTool = new FileSystemTool()
    const memorySaver = new MemorySaver()

    // Initialize agent
    const agent = new ReActAgent({
      chatModel: chat,
      modelName: 'qwen2.5-coder:7b',
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      tools: [fileSystemTool],
      maxIterations: 30,
      userInputTimeout: 36000,
      memoryPersistence: memorySaver,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      maxEntries: 1000,
      relevancyThreshold: 0.7,
      safetyConfig: {
        requireToolConfirmation: true,
        requireToolFeedback: true,
        maxInputLength: 10000,
        dangerousToolPatterns: ['drop', 'truncate', 'exec', 'curl', 'wget', 'bash -c', 'rm  -rf /', 'zsh -c', 'sh -c'],
      },
    })

    // Initialize and start server
    const server = new Server({
      agent,
      memory,
      port: parseInt(process.env.PORT || '3000', 10),
    })

    await server.start()

    // Handle graceful shutdown
    const signals = ['SIGTERM', 'SIGINT']
    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, shutting down...`)
        await server.stop()
        process.exit(0)
      })
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

main()
