import { BaseReActTool } from './baseTool'

export class DatabaseTool extends BaseReActTool {
  name = 'database'
  description = 'Tool for database operations'
  requiresReview = true
  private store: Map<string, string>

  constructor() {
    super()
    this.store = new Map()
  }

  public transformInput(input: string): string | undefined {
    try {
      const parsed = JSON.parse(input)
      if (!parsed.action || !parsed.key) {
        return undefined
      }
      return JSON.stringify(parsed)
    } catch {
      return undefined
    }
  }

  protected async execute(input: string): Promise<string> {
    const { action, key, value } = JSON.parse(input)

    switch (action) {
      case 'get':
        const storedValue = this.store.get(key)
        if (!storedValue) {
          throw new Error(`Key not found: ${key}`)
        }
        return storedValue
      case 'set':
        if (!value) {
          throw new Error('Value required for set operation')
        }
        this.store.set(key, value)
        return `Successfully set value for ${key}`
      case 'delete':
        if (!this.store.has(key)) {
          throw new Error(`Key not found: ${key}`)
        }
        this.store.delete(key)
        return `Successfully deleted ${key}`
      case 'list':
        return JSON.stringify(Array.from(this.store.keys()))
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  }
}
