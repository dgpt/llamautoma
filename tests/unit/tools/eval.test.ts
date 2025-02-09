import { expect, test, describe } from 'bun:test'
import { evalTool } from '@/ai/tools/eval'

describe('Eval Tool', () => {
  test('should execute basic arithmetic', async () => {
    const result = await evalTool.invoke({ code: 'return 2 + 2' })
    expect(result).toBe('4')
  })

  test('should handle console output', async () => {
    const result = await evalTool.invoke({
      code: 'console.log("Hello"); console.warn("Warning"); console.error("Error"); return 42',
    })
    expect(result).toContain('[log] Hello')
    expect(result).toContain('[warn] Warning')
    expect(result).toContain('[error] Error')
    expect(result).toContain('42')
  })

  test('should handle syntax errors', async () => {
    await expect(evalTool.invoke({ code: 'return const x =' })).rejects.toThrow()
  })

  test('should prevent access to dangerous globals', async () => {
    await expect(evalTool.invoke({ code: 'return process.exit(1)' })).rejects.toThrow(
      "Can't find variable: process"
    )
  })

  test('should handle complex objects in console output', async () => {
    const result = await evalTool.invoke({
      code: 'const hello = "world"; const obj = { hello }; console.log(obj); console.log([1, 2, 3]); return true',
    })
    expect(result).toContain('[log] {"hello":"world"}')
    expect(result).toContain('[log] [1,2,3]')
    expect(result).toContain('true')
  })

  test('should handle maxOutputLength configuration', async () => {
    await expect(
      evalTool.invoke({
        code: 'console.log("this is a very long message that should exceed the limit"); return true',
        maxOutputLength: 10,
      })
    ).rejects.toThrow('Output exceeds maximum length')
  })

  test('should handle multiple statements and return last value', async () => {
    const result = await evalTool.invoke({
      code: 'let x = 1; x += 2; x *= 3; return x',
    })
    expect(result).toBe('9')
  })

  test('should handle TypeScript features', async () => {
    const result = await evalTool.invoke({
      code: `
        interface Person {
          name: string;
          age: number;
        }
        const name = "Alice";
        const age = 30;
        const person = { name, age };
        return JSON.stringify(person);
      `,
    })
    expect(result).toBe('{"name":"Alice","age":30}')
  })

  test('should prevent access to file system operations', async () => {
    await expect(
      evalTool.invoke({
        code: 'return require("fs")',
      })
    ).rejects.toThrow("Can't find variable: require")
  })

  test('should handle undefined and null values', async () => {
    let result = await evalTool.invoke({ code: 'return undefined' })
    expect(result).toBe('undefined')

    result = await evalTool.invoke({ code: 'return null' })
    expect(result).toBe('null')
  })

  test('should handle errors in async code', async () => {
    await expect(
      evalTool.invoke({
        code: 'throw new Error("Test error")',
      })
    ).rejects.toThrow('Test error')
  })
})
