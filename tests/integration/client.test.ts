import { expect, test, describe, beforeEach } from 'bun:test'
import { BaseMessage, HumanMessage, AIMessage, AIMessageChunk, SystemMessage } from '@langchain/core/messages'
import { IterableReadableStream } from '@langchain/core/utils/stream'
import { LlamautomaClient } from '../../src/client'
import { FileSystemSync } from '../../src/utils/fs'
import { LlamautomaResponse } from '../../src/client'
import { ChatOllama } from '@langchain/ollama'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { TEST_CONFIG } from '../testConfig'

describe('Llamautoma Client Integration Tests', () => {
  let client: LlamautomaClient
  let fs: FileSystemSync

  beforeEach(() => {
    client = new LlamautomaClient({
      model: 'qwen2.5-coder:1.5b',
      baseUrl: 'http://localhost:11434',
    })
    fs = new FileSystemSync()
  })

  test(
    'should handle chat interactions',
    async () => {
      const response = (await client.chat('What is the capital of France?')) as LlamautomaResponse
      expect(response).toBeDefined()
      expect(response.status).toBe('success')
      expect(response.messages[0].content).toBeDefined()
      expect(typeof response.messages[0].content).toBe('string')
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle streaming responses',
    async () => {
      const messages: string[] = []
      const stream = await client.chat('Tell me a story', { stream: true })

      if ('messages' in stream) {
        throw new Error('Expected streaming response')
      }

      for await (const chunk of stream) {
        messages.push(chunk.content.toString())
      }

      expect(messages.length).toBeGreaterThan(0)
      expect(messages.every((m) => typeof m === 'string')).toBe(true)
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle file editing',
    async () => {
      // Create a test file
      const testFile = 'test.txt'
      await fs.writeFile(testFile, 'Hello World')

      // Edit the file
      const response = await client.edit('Add a second line saying "Goodbye World" to test.txt')
      expect(response.status).toBe('success')
      expect(response.edits).toBeDefined()
      expect(response.edits.length).toBeGreaterThan(0)
      expect(response.edits[0].file).toBe('test.txt')

      // Verify the changes
      const content = await fs.readFile(testFile)
      expect(content).toContain('Hello World')
      expect(content).toContain('Goodbye World')

      // Clean up
      await fs.deleteFile(testFile)
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle file composition',
    async () => {
      // Compose a new file with explicit instructions for JSON format
      const response = await client.compose(`Create a simple HTML file that displays "Hello World".
Please respond with a JSON object in this exact format:
{
  "files": [
    {
      "path": "index.html",
      "content": "<!DOCTYPE html>\\n<html>\\n<head>\\n<title>Hello World</title>\\n</head>\\n<body>\\n<h1>Hello World</h1>\\n</body>\\n</html>"
    }
  ]
}`)

      expect(response.status).toBe('success')
      expect(response.files).toBeDefined()
      expect(response.files.length).toBeGreaterThan(0)

      const htmlFile = response.files[0]
      expect(htmlFile).toBeDefined()
      expect(typeof htmlFile.path).toBe('string')
      expect(typeof htmlFile.content).toBe('string')
      expect(htmlFile.path).toMatch(/\.html$/)

      // Verify the file was created
      const content = await fs.readFile(htmlFile.path)
      expect(content).toMatch(/<html/i)
      expect(content).toMatch(/hello world/i)

      // Clean up
      await fs.deleteFile(htmlFile.path)
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should handle directory synchronization',
    async () => {
      // Create some test files
      const testDir = 'test_dir'
      await fs.createDirectory(testDir)
      await fs.writeFile(`${testDir}/file1.txt`, 'Content 1')
      await fs.writeFile(`${testDir}/file2.txt`, 'Content 2')

      // Sync the directory
      const response = await client.sync(testDir)
      expect(response.status).toBe('success')
      expect(response.files).toBeDefined()
      expect(response.files.length).toBe(2)
      expect(response.files.some((f: { path: string }) => f.path.endsWith('file1.txt'))).toBe(true)
      expect(response.files.some((f: { path: string }) => f.path.endsWith('file2.txt'))).toBe(true)

      // Clean up
      await fs.deleteDirectory(testDir)
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )

  test(
    'should respect .gitignore during sync',
    async () => {
      // Create test directory with .gitignore
      const testDir = 'test_dir_gitignore'
      await fs.createDirectory(testDir)
      await fs.writeFile(`${testDir}/.gitignore`, 'ignored.txt')
      await fs.writeFile(`${testDir}/normal.txt`, 'Normal content')
      await fs.writeFile(`${testDir}/ignored.txt`, 'Ignored content')

      // Sync the directory
      const response = await client.sync(testDir)
      expect(response.status).toBe('success')
      expect(response.files).toBeDefined()
      expect(response.files.length).toBe(1)
      expect(response.files[0].path.endsWith('normal.txt')).toBe(true)
      expect(response.files.some((f: { path: string }) => f.path.endsWith('ignored.txt'))).toBe(false)

      // Clean up
      await fs.deleteDirectory(testDir)
    },
    TEST_CONFIG.INTEGRATION_TEST_TIMEOUT
  )
})
