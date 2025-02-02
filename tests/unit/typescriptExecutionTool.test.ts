import { expect, test, describe } from 'bun:test'
import { TypeScriptExecutionTool } from '../../src/agents/react/tools/typescriptExecutionTool'

describe('TypeScriptExecutionTool', () => {
  test('should execute basic arithmetic', async () => {
    const tool = new TypeScriptExecutionTool()
    const input = JSON.stringify({
      code: '2 + 2',
      config: { hideMessage: false }
    })

    const result = await tool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(true)
    expect(parsed.result).toBe('4')
    expect(parsed.logs).toEqual([])
  })

  test('should handle console output', async () => {
    const tool = new TypeScriptExecutionTool()
    const input = JSON.stringify({
      code: 'console.log("Hello"); console.warn("Warning"); console.error("Error"); 42',
      config: { hideMessage: false }
    })

    const result = await tool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(true)
    expect(parsed.result).toBe('42')
    expect(parsed.logs).toEqual([
      ['log', 'Hello'],
      ['warn', 'Warning'],
      ['error', 'Error']
    ])
  })

  test('should timeout on infinite loops', async () => {
    const tool = new TypeScriptExecutionTool()
    const input = JSON.stringify({
      code: 'while(true) {}',
      config: { timeout: 100 }
    })

    const result = await tool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(false)
    expect(parsed.error).toBe('Execution timed out')
  })

  test('should handle syntax errors', async () => {
    const tool = new TypeScriptExecutionTool()
    const input = JSON.stringify({
      code: 'const x =',
      config: { hideMessage: false }
    })

    const result = await tool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(false)
    expect(parsed.error).toContain('SyntaxError')
  })

  test('should prevent access to dangerous globals', async () => {
    const tool = new TypeScriptExecutionTool()
    const input = JSON.stringify({
      code: 'try { process.exit(1) } catch(e) { "Safe" }',
      config: { hideMessage: false }
    })

    const result = await tool.call(input)
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(true)
    expect(parsed.result).toBe('Safe')
  })

  test('should handle invalid input', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.call('not json')
    const parsed = JSON.parse(result)

    expect(parsed.success).toBe(false)
    expect(parsed.error).toContain('Invalid input')
  })
})