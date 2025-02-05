# 🦙 🤖 Llamautoma

A powerful, TypeScript-based AI agent framework built on top of LangChain for automated code generation, editing, and management. Designed to work seamlessly with modern language models and development workflows.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![LangChain](https://img.shields.io/badge/🦜_LangChain-000000?style=flat-square)](https://js.langchain.com/)

## ✨ Features

- 🚀 High-performance TypeScript execution engine
- 🔄 Real-time code generation and editing via chat
- 🧠 Advanced AI agent system with ReAct framework
- 🔒 Built-in safety controls and validation
- 📝 Streaming responses for real-time feedback
- 🛠️ Extensible tool system

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime installed
- A compatible language model (e.g., Ollama with qwen2.5-coder)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/llamautoma.git
cd llamautoma

# Install dependencies
bun install

# Start the server
bun run start
```

## 🔌 API Reference

The server exposes HTTP endpoints for chat and workspace synchronization. All endpoints accept POST requests and expect JSON payloads.

### Base URL
```
http://localhost:3000/v1
```

### Common Request Properties

All requests support these common properties:
- `threadId` (optional): Unique identifier for the conversation thread
- `safetyConfig` (optional): Configuration for safety controls
  - `maxInputLength`: Maximum allowed input length (default: 8192)
  - `requireToolConfirmation`: Whether to require confirmation for tool usage
  - `requireToolFeedback`: Whether to require feedback for tool usage
  - `dangerousToolPatterns`: Array of patterns to flag as potentially dangerous

### Common Response Format

All endpoints return Server-Sent Events (SSE) streams with the following event types:
- `start`: Initial response start with metadata
- `content`: Main response content (may be sent multiple times)
- `end`: Response completion with final results

The specific content of each event varies by endpoint but follows this general structure:
```typescript
{
  "event": "start" | "content" | "end",
  "threadId": string,
  "data": {
    // Endpoint-specific data structure
  }
}
```

### 1. Chat Endpoint
`POST /v1/chat`

Interactive chat endpoint with streaming responses. Handles all code operations through natural language.

```typescript
{
  "messages": [
    {
      "role": "user",
      "content": "Create a React component for a user profile"
    }
  ],
  "threadId": "optional-thread-id",
  "safetyConfig": {
    "maxInputLength": 8192
  }
}
```

Response: Server-Sent Events (SSE) stream with the following events:
- `start`: Initial response start
- `content`: Main response content
- `end`: Response completion

### 2. Sync Endpoint
`POST /v1/sync`

Synchronize and analyze codebase structure with progress updates.

```typescript
{
  "root": "/path/to/project",
  "excludePatterns": ["node_modules", "dist", ".git"]
}
```

Response: Server-Sent Events (SSE) stream with file content and status updates.

## 🔒 Safety Features

Llamautoma includes several safety features to prevent potentially harmful operations:

- Input length validation
- Dangerous pattern detection
- Tool execution confirmation
- Execution feedback collection
- Rate limiting

## 🛠️ Configuration

The server can be configured through environment variables or the config file:

```typescript
{
  "modelName": "qwen2.5-coder:7b",
  "host": "http://localhost:11434",
  "maxIterations": 10,
  "userInputTimeout": 30000,
  "safetyConfig": {
    "requireToolConfirmation": true,
    "requireToolFeedback": true,
    "maxInputLength": 8192,
    "dangerousToolPatterns": [
      "rm -rf /",
      "DROP TABLE",
      "sudo rm",
      // ... more patterns
    ]
  }
}
```

## 📝 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
