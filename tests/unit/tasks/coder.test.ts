import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint, task } from '@langchain/langgraph'
import { z } from 'zod'
import { createTestContext, waitForResponse, type TestContext } from '../utils'

// Schema for coder output
const CoderSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      type: z.enum(['create', 'modify', 'delete']),
      description: z.string(),
    })
  ),
  dependencies: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        type: z.enum(['npm', 'pip', 'cargo', 'other']).optional(),
      })
    )
    .optional(),
  commands: z
    .array(
      z.object({
        command: z.string(),
        description: z.string(),
        requires_user_approval: z.boolean(),
      })
    )
    .optional(),
  requires_review: z.boolean(),
  review_notes: z.array(z.string()).optional(),
})

describe('Coder Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should generate code based on a plan', async () => {
    const coderTask = task('coder', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'coder_test' },
      async (messages: BaseMessage[]) => {
        const result = await coderTask(messages)
        return result
      }
    )

    const plan = {
      plan: [
        {
          step: 1,
          description: 'Create a new React component for a counter',
          tools: ['edit_file'],
        },
        {
          step: 2,
          description: 'Add TypeScript types and props interface',
          tools: ['edit_file'],
        },
        {
          step: 3,
          description: 'Implement increment/decrement functionality',
          tools: ['edit_file'],
        },
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code generator. Generate code based on this plan.'),
      new HumanMessage('Create a React counter component with TypeScript'),
      new SystemMessage(JSON.stringify(plan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const generated = JSON.parse(result.content.toString())

    expect(() => CoderSchema.parse(generated)).not.toThrow()
    expect(generated.files.length).toBeGreaterThan(0)

    const counterComponent = generated.files.find(
      (f: z.infer<typeof CoderSchema>['files'][number]) =>
        f.path.toLowerCase().includes('counter') && f.path.endsWith('.tsx')
    )
    expect(counterComponent).toBeDefined()
    expect(counterComponent?.content).toContain('useState')
    expect(counterComponent?.content).toContain('interface')
    expect(counterComponent?.content).toContain('increment')
  })

  test('should handle dependency management', async () => {
    const coderTask = task('coder', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'coder_test' },
      async (messages: BaseMessage[]) => {
        const result = await coderTask(messages)
        return result
      }
    )

    const plan = {
      plan: [
        {
          step: 1,
          description: 'Initialize new React project with TypeScript',
          tools: ['run_terminal_cmd'],
        },
        {
          step: 2,
          description: 'Add required dependencies',
          tools: ['edit_file'],
        },
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code generator. Set up a new React project.'),
      new HumanMessage('Create a new React project with TypeScript and styled-components'),
      new SystemMessage(JSON.stringify(plan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const generated = JSON.parse(result.content.toString())

    expect(() => CoderSchema.parse(generated)).not.toThrow()
    expect(generated.dependencies).toBeDefined()
    const deps = generated.dependencies as z.infer<typeof CoderSchema>['dependencies']
    expect(deps?.some(d => d.name === 'styled-components')).toBe(true)
    expect(generated.commands).toBeDefined()
    const cmds = generated.commands as z.infer<typeof CoderSchema>['commands']
    expect(
      cmds?.some(
        c => c.command.includes('npm') || c.command.includes('yarn') || c.command.includes('pnpm')
      )
    ).toBe(true)
  })

  test('should generate complete project structure', async () => {
    const coderTask = task('coder', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'coder_test' },
      async (messages: BaseMessage[]) => {
        const result = await coderTask(messages)
        return result
      }
    )

    const plan = {
      plan: [
        {
          step: 1,
          description: 'Create project structure with TypeScript configuration',
          tools: ['edit_file'],
        },
        {
          step: 2,
          description: 'Implement core components',
          tools: ['edit_file'],
        },
        {
          step: 3,
          description: 'Add styling and theme',
          tools: ['edit_file'],
        },
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code generator. Create a complete project structure.'),
      new HumanMessage(
        'Create a React app with TypeScript, styled-components, and a counter component'
      ),
      new SystemMessage(JSON.stringify(plan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const generated = JSON.parse(result.content.toString())

    expect(() => CoderSchema.parse(generated)).not.toThrow()

    // Check for essential project files
    const hasPackageJson = generated.files.some(
      (f: z.infer<typeof CoderSchema>['files'][number]) => f.path === 'package.json'
    )
    const hasTsConfig = generated.files.some(
      (f: z.infer<typeof CoderSchema>['files'][number]) => f.path === 'tsconfig.json'
    )
    const hasComponent = generated.files.some((f: z.infer<typeof CoderSchema>['files'][number]) =>
      f.path.includes('components/')
    )
    const hasStyles = generated.files.some(
      (f: z.infer<typeof CoderSchema>['files'][number]) =>
        f.path.includes('styles/') || f.content.includes('styled-components')
    )

    expect(hasPackageJson).toBe(true)
    expect(hasTsConfig).toBe(true)
    expect(hasComponent).toBe(true)
    expect(hasStyles).toBe(true)
  })

  test('should request review for complex changes', async () => {
    const coderTask = task('coder', async (messages: BaseMessage[]) => {
      return await ctx.chatModel.invoke(messages)
    })

    const workflow = entrypoint(
      { checkpointer: ctx.memorySaver, name: 'coder_test' },
      async (messages: BaseMessage[]) => {
        const result = await coderTask(messages)
        return result
      }
    )

    const plan = {
      plan: [
        {
          step: 1,
          description: 'Implement complex state management logic',
          tools: ['edit_file'],
        },
        {
          step: 2,
          description: 'Add error handling and validation',
          tools: ['edit_file'],
        },
        {
          step: 3,
          description: 'Optimize performance with memoization',
          tools: ['edit_file'],
        },
      ],
      requires_clarification: false,
    }

    const messages = [
      new SystemMessage('You are a code generator. Implement complex features.'),
      new HumanMessage(
        'Create a React component with complex state management, error handling, and performance optimizations'
      ),
      new SystemMessage(JSON.stringify(plan)),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const generated = JSON.parse(result.content.toString())

    expect(() => CoderSchema.parse(generated)).not.toThrow()
    expect(generated.requires_review).toBe(true)
    expect(generated.review_notes).toBeDefined()
    expect(generated.review_notes?.length).toBeGreaterThan(0)

    // Check for complex features in the code
    const mainComponent = generated.files.find((f: z.infer<typeof CoderSchema>['files'][number]) =>
      f.path.includes('components/')
    )
    expect(mainComponent?.content).toContain('useCallback')
    expect(mainComponent?.content).toContain('useMemo')
    expect(mainComponent?.content).toContain('try')
    expect(mainComponent?.content).toContain('catch')
  })
})
