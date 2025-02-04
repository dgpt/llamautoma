import { expect, test, describe } from 'bun:test'
import { TypeScriptExecutionTool } from '@/ai/tools/eval'

describe('TypeScriptExecutionTool', () => {
  test('should execute basic arithmetic', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({ code: 'return 2 + 2' })
    expect(result).toBe('4')
  })

  test('should handle console output', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({
      code: 'console.log("Hello"); console.warn("Warning"); console.error("Error"); return 42',
    })
    expect(result).toContain('[log] Hello')
    expect(result).toContain('[warn] Warning')
    expect(result).toContain('[error] Error')
    expect(result).toContain('42')
  })

  test('should handle syntax errors', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(tool.invoke({ code: 'return const x =' })).rejects.toThrow()
  })

  test('should prevent access to dangerous globals', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(tool.invoke({ code: 'return process.exit(1)' })).rejects.toThrow(
      "Can't find variable: process"
    )
  })

  test('should handle complex objects in console output', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({
      code: 'console.log({ hello: "world" }); console.log([1, 2, 3]); return true',
    })
    expect(result).toContain('[log] {"hello":"world"}')
    expect(result).toContain('[log] [1,2,3]')
  })

  test('should respect maxOutputLength configuration', async () => {
    const tool = new TypeScriptExecutionTool({ maxOutputLength: 10 })
    return expect(
      tool.invoke({
        code: 'console.log("this is a very long message that should exceed the limit"); return true',
      })
    ).rejects.toThrow('Output exceeds maximum length')
  })

  test('should handle multiple statements and return last value', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({
      code: 'let x = 1; x += 2; x *= 3; return x',
    })
    expect(result).toBe('9')
  })

  test('should handle synchronous code execution', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({
      code: 'return (() => 42)()',
    })
    expect(result).toBe('42')
  })

  test('should prevent access to file system operations', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(
      tool.invoke({
        code: 'return require("fs")',
      })
    ).rejects.toThrow("Can't find variable: require")
  })

  test('should handle undefined and null values', async () => {
    const tool = new TypeScriptExecutionTool()
    let result = await tool.invoke({ code: 'return undefined' })
    expect(result).toBe('undefined')

    result = await tool.invoke({ code: 'return null' })
    expect(result).toBe('null')
  })

  test('should handle JavaScript objects', async () => {
    const tool = new TypeScriptExecutionTool()
    const result = await tool.invoke({
      code: `
        const person = { name: "Alice", age: 30 };
        return JSON.stringify(person)
      `,
    })
    expect(result).toBe('{"name":"Alice","age":30}')
  })

  test('should handle errors in async code', async () => {
    const tool = new TypeScriptExecutionTool()
    return expect(
      tool.invoke({
        code: 'throw new Error("Test error")',
      })
    ).rejects.toThrow('Test error')
  })
})