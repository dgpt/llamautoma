import { expect, test, describe, spyOn } from 'bun:test'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { runWithTestConfig } from '../utils'
import { plannerTask, ResponseType } from '@/ai/tasks/planner'
import { PlannerTaskSchema, type PlannerTaskOutput } from '@/ai/tasks/schemas/tasks'
import * as llmModule from '@/ai/llm'
import { DEFAULT_CONFIG } from '@/config'
import { RunnableSequence } from '@langchain/core/runnables'

describe('Planner Task Tests', () => {
  test('should create plan for code request', async () => {
    const mockResponse = {
      explanation: 'Create a hello world function that prints a greeting',
      steps: [
        {
          step: '1',
          description: 'Create function definition',
        },
        {
          step: '2',
          description: 'Add print statement',
        },
      ],
    }

    const createLLMSpy = spyOn(llmModule, 'createStructuredLLM')
    createLLMSpy.mockImplementation(
      () =>
        ({
          invoke: async () => mockResponse,
          lc_namespace: ['test'],
        }) as unknown as RunnableSequence
    )

    try {
      const messages = [
        new SystemMessage('You are a code generation assistant.'),
        new HumanMessage('Create a simple hello world function'),
      ]

      const result = await runWithTestConfig<PlannerTaskOutput>(plannerTask, {
        messages,
        config: DEFAULT_CONFIG,
      })

      // Verify schema validation
      expect(() => PlannerTaskSchema.parse(result)).not.toThrow()

      // Verify required fields
      expect(result.plan).toBe(mockResponse.explanation)
      expect(typeof result.plan).toBe('string')
      expect(result.plan.length).toBeGreaterThan(0)

      // Verify steps
      expect(result.steps).toBeDefined()
      expect(Array.isArray(result.steps)).toBe(true)
      expect(result.steps?.length).toBe(mockResponse.steps.length)

      const firstStep = result.steps?.[0]
      expect(firstStep).toBeDefined()
      expect(firstStep?.step).toBe(mockResponse.steps[0].step)
      expect(firstStep?.description).toBe(mockResponse.steps[0].description)
      expect(firstStep?.status).toBe('pending')

      // Verify response
      expect(result.response).toBeDefined()
      expect(result.response.type).toBe(ResponseType.Plan)
      expect(result.response.content).toBe(mockResponse.explanation)
      expect(result.response.shouldDisplay).toBe(true)
      expect(result.response.timestamp).toBeDefined()

      // Verify stream responses
      expect(result.streamResponses).toBeDefined()
      expect(Array.isArray(result.streamResponses)).toBe(true)
      expect(result.streamResponses.length).toBe(4) // Start + 2 steps + End

      // Verify progress messages
      const startProgress = result.streamResponses.find(
        r => r.type === ResponseType.Progress && r.content === 'Creating plan...'
      )
      expect(startProgress).toBeDefined()

      const endProgress = result.streamResponses.find(
        r => r.type === ResponseType.Progress && r.content === 'Plan created successfully'
      )
      expect(endProgress).toBeDefined()

      // Verify step messages
      const stepMessages = result.streamResponses.filter(r => r.type === ResponseType.Plan)
      expect(stepMessages.length).toBe(result.steps!.length)
      expect(stepMessages[0].content).toBe(
        `Step ${mockResponse.steps[0].step}: ${mockResponse.steps[0].description}`
      )
      expect(stepMessages[1].content).toBe(
        `Step ${mockResponse.steps[1].step}: ${mockResponse.steps[1].description}`
      )
    } finally {
      createLLMSpy.mockRestore()
    }
  })

  test('should handle empty message input', async () => {
    await expect(
      runWithTestConfig<PlannerTaskOutput>(plannerTask, {
        messages: [],
        config: DEFAULT_CONFIG,
      })
    ).rejects.toThrow('No messages provided to planner task')
  })

  test('should handle LLM errors', async () => {
    const createLLMSpy = spyOn(llmModule, 'createStructuredLLM')
    createLLMSpy.mockImplementation(() => {
      throw new Error('LLM error')
    })

    try {
      await expect(
        runWithTestConfig<PlannerTaskOutput>(plannerTask, {
          messages: [new HumanMessage('test')],
          config: DEFAULT_CONFIG,
        })
      ).rejects.toThrow('LLM error')
    } finally {
      createLLMSpy.mockRestore()
    }
  })

  test('should use default config when none provided', async () => {
    const mockResponse = {
      explanation: 'Test plan with default config',
      steps: [
        {
          step: '1',
          description: 'Test step',
        },
      ],
    }

    const createLLMSpy = spyOn(llmModule, 'createStructuredLLM')
    createLLMSpy.mockImplementation(
      () =>
        ({
          invoke: async () => mockResponse,
          lc_namespace: ['test'],
        }) as unknown as RunnableSequence
    )

    try {
      const messages = [
        new SystemMessage('You are a code generation assistant.'),
        new HumanMessage('Create a simple hello world function'),
      ]

      const result = await runWithTestConfig<PlannerTaskOutput>(plannerTask, {
        messages,
      })

      expect(() => PlannerTaskSchema.parse(result)).not.toThrow()
      expect(result.plan).toBe(mockResponse.explanation)
    } finally {
      createLLMSpy.mockRestore()
    }
  })

  test('should handle schema validation errors', async () => {
    const mockInvalidResponse = {
      explanation: 123, // Should be string
      steps: [{ step: 1 }], // Missing required fields
    }

    const createLLMSpy = spyOn(llmModule, 'createStructuredLLM')
    createLLMSpy.mockImplementation(
      () =>
        ({
          invoke: async () => mockInvalidResponse,
          lc_namespace: ['test'],
        }) as unknown as RunnableSequence
    )

    try {
      await expect(
        runWithTestConfig<PlannerTaskOutput>(plannerTask, {
          messages: [new HumanMessage('test')],
          config: DEFAULT_CONFIG,
        })
      ).rejects.toThrow()
    } finally {
      createLLMSpy.mockRestore()
    }
  })
})
