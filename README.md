# Llamautoma

AI-powered automation server using LangChain.js and LangGraph.js. This server is part of the coc-llama project, providing AI-assisted code generation and editing features.

## Features

- **Chat**: Stream-based chat interface with AI model
- **Edit**: AI-assisted code editing with file modifications
- **Compose**: AI-powered file generation
- **Embed**: File and text embedding for context-aware operations
- **Tools**: Extensible tool system with safety checks

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- [Ollama](https://ollama.ai/) with `qwen2.5-coder:7b` model

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/llamautoma.git
cd llamautoma

# Install dependencies
bun install
```

## Configuration

The server can be configured using environment variables:

- `PORT`: Server port (default: 3000)
- `OLLAMA_HOST`: Ollama server URL (default: http://localhost:11434)
- `LOG_LEVEL`: Logging level (default: info)

## Development

```bash
# Start development server with hot reload
bun run dev

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Lint code
bun run lint

# Format code
bun run format
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

### Tools

#### Register Tool (`POST /tools`)

Register a new tool with the server.

```typescript
// Request
{
  name: string
  description: string
  schema: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

// Response
{
  success: boolean
  toolId: string
}
```

#### Execute Tool (`POST /tools/execute`)

Execute a registered tool.

```typescript
// Request
{
  toolId: string
  input: unknown
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

## License

MIT
