import { expect, test, describe, beforeEach } from 'bun:test'
import { RunTool } from '@/ai/tools/run'

describe('Run Tool', () => {
  let tool: RunTool

  beforeEach(() => {
    tool = new RunTool()
  })

  test('should format basic command', async () => {
    const result = await tool.invoke({ command: 'ls -la' })
    expect(JSON.parse(result)).toEqual({
      command: 'ls -la',
      isBackground: false,
      requireUserApproval: true,
      explanation: expect.any(String),
    })
  })

  test('should handle background commands', async () => {
    const result = await tool.invoke({
      command: 'npm start',
      isBackground: true,
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('npm start')
    expect(parsed.isBackground).toBe(true)
    expect(parsed.requireUserApproval).toBe(true)
  })

  test('should handle commands requiring approval', async () => {
    const result = await tool.invoke({
      command: 'rm file.txt',
      requireUserApproval: true,
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('rm file.txt')
    expect(parsed.requireUserApproval).toBe(true)
  })

  test('should handle commands with explanation', async () => {
    const result = await tool.invoke({
      command: 'git status',
      explanation: 'Check git repository status',
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('git status')
    expect(parsed.explanation).toBe('Check git repository status')
  })

  test('should handle empty command', async () => {
    await expect(tool.invoke({ command: '' })).rejects.toThrow()
  })

  test('should handle commands with special characters', async () => {
    const result = await tool.invoke({
      command: 'echo "Hello & World"',
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('echo "Hello & World"')
  })

  test('should handle commands with pipes', async () => {
    const result = await tool.invoke({
      command: 'ls -la | grep ".ts"',
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('ls -la | grep ".ts"')
  })

  test('should handle commands with environment variables', async () => {
    const result = await tool.invoke({
      command: 'echo $HOME',
    })
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('echo $HOME')
  })
})
