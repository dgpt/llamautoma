# Llamautoma

AI-powered automation server using LangChain.js, LangGraph.js, and Ollama. This server is part of the coc-llamautoma project, providing AI-assisted code generation and editing features through a streaming API.

## Features

- **Chat**: Stream-based chat interface with AI model for code-related discussions
- **Edit**: AI-assisted code editing with file modifications and safety checks
- **Compose**: AI-powered file generation with context awareness
- **Embed**: File and text embedding for context-aware operations
- **Tools**: Extensible tool system with safety checks and user confirmation
- **LSP Integration**: Language Server Protocol support for IDE integration
- **Streaming**: Real-time streaming responses for all operations
- **Safety**: Built-in safety checks and user confirmation for dangerous operations
- **Memory**: Short-term and long-term memory using LangGraph.js

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- [Ollama](https://ollama.ai/) with required models:
  - Default: `qwen2.5-coder:7b` (production)
  - Testing: `qwen2.5-coder:1.5b` (faster for tests)

## Installation

```bash
# Clone the repository
git clone https://github.com/dgpt/llamautoma.git
cd llamautoma

# Install dependencies
bun install

# Start the server
bun run dev
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000                              # Server port (default: 3000)
OLLAMA_HOST=http://localhost:11434     # Ollama server URL
LOG_LEVEL=info                         # Logging level (debug|info|warn|error)

# Agent Configuration
MODEL_NAME=qwen2.5-coder:7b            # Default model name
MAX_ITERATIONS=10                      # Maximum iterations per request
USER_INPUT_TIMEOUT=30000              # Timeout for user input (ms)
```

### Safety Configuration

The server includes built-in safety checks that can be configured:

```typescript
{
  requireToolConfirmation: true,      // Require user confirmation for tool execution
  requireToolFeedback: true,          // Require user feedback after tool execution
  maxInputLength: 8192,               // Maximum input length
  dangerousToolPatterns: [            // Patterns requiring extra confirmation
    'rm -rf /',
    'DROP TABLE',
    'sudo rm',
    'wget http',
    'curl',
    'exec',
    'bash -c',
    'zsh -c',
    'sh -c'
  ]
}
```

## API Endpoints

### Chat (`POST /chat`)

Stream-based chat interface with the AI model.

```typescript
// Request
{
  messages: Array<{
    role: 'user' | 'system' | 'assistant'
    content: string
  }>
  threadId: string
}

// Response (Server-Sent Events)
data: {
  messages: Array<BaseMessage>
  status: 'continue' | 'end'
  toolFeedback: Record<string, string>
  iterations: number
  threadId: string
}
```

### Edit (`POST /edit`)

AI-assisted code editing with file modifications.

```typescript
// Request
{
  file: string
  prompt: string
  threadId: string
}

// Response (Server-Sent Events)
data: {
  type: 'edit'
  messages: Array<BaseMessage>
  status: 'continue' | 'end'
  toolFeedback: Record<string, string>
  iterations: number
  threadId: string
}
```

### Compose (`POST /compose`)

AI-powered file generation.

```typescript
// Request
{
  prompt: string
  threadId: string
}

// Response (Server-Sent Events)
data: {
  type: 'compose'
  messages: Array<BaseMessage>
  status: 'continue' | 'end'
  toolFeedback: Record<string, string>
  iterations: number
  threadId: string
}
```

### Embed (`POST /embed`)

File and text embedding for context-aware operations.

```typescript
// Request
{
  type: 'file' | 'text'
  path?: string
  content: string
}

// Response
{
  success: boolean
  embeddings: number[]
}
```

## Development

```bash
# Start development server with hot reload
bun run dev

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage

# Lint code
bun run lint

# Format code
bun run format
```

## Project Structure

```
llamautoma/
├── src/
│   ├── agents/         # AI agents and tools
│   ├── config/         # Configuration management
│   ├── server/         # Server implementation
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utility functions
├── tests/
│   ├── unit/          # Unit tests
│   └── integration/   # Integration tests
└── package.json
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT
