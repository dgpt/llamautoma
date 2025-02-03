import { expect, test, describe } from 'bun:test'
import { TypeScriptExecutionTool } from '@/agents/tools/typescriptExecutionTool'

describe('TypeScriptExecutionTool', () => {
  test('should execute basic arithmetic', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke('2 + 2')
    expect(result).toBe('4')
  })

  test('should handle console output', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke(
      'console.log("Hello"); console.warn("Warning"); console.error("Error"); 42'
    )
    expect(result).toContain('[log] Hello')
    expect(result).toContain('[warn] Warning')
    expect(result).toContain('[error] Error')
    expect(result.trim().endsWith('42')).toBe(true)
  })

  test('should handle syntax errors', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(tool.invoke('const x =')).rejects.toThrow('Unexpected end of script')
  })

  test('should prevent access to dangerous globals', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(tool.invoke('process.exit(1)')).rejects.toThrow("Can't find variable: process")
  })

  test('should handle invalid input', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(tool.invoke('not json')).rejects.toThrow()
  })
})