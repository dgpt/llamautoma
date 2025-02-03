import { Tool } from '@langchain/core/tools'
import { AIMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { AgentState, ToolExecutionResult } from '@/types/agent'
import { logger } from '@/logger'

// Constants
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY = 1000 // 1 second
const MAX_RETRY_DELAY = 5000 // 5 seconds

// Validate tool input
const validateInput = task('validate_input', async (input: string) => {
  try {
    if (!input) {
      return { success: false, error: new Error('Input is required') }
    }

    const trimmedInput = input.trim()
    if (!trimmedInput.startsWith('{')) {
      return { success: true, parsedInput: input }
    }

    const parsed = JSON.parse(trimmedInput)
    return { success: true, parsedInput: JSON.stringify(parsed) }
  } catch (error) {
    logger.warn('Input validation failed', { input, error })
    return { success: false, error: error instanceof Error ? error : new Error('Invalid input') }
  }
})

// Execute tool with retries
const executeWithRetries = task(
  'execute_with_retries',
  async (tool: Tool, input: string, signal?: AbortSignal) => {
    let lastError: Error | undefined
    let attempt = 0
    let delay = INITIAL_RETRY_DELAY

    while (attempt < MAX_RETRIES) {
      try {
        if (signal?.aborted) {
          throw new Error('Operation aborted')
        }

        const output = await tool.call(input, { signal })
        return { success: true, output: output.toString() }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.message === 'Operation aborted')) {
          throw error
        }

        lastError = error instanceof Error ? error : new Error(String(error))
        logger.warn(`Tool execution failed (attempt ${attempt + 1}/${MAX_RETRIES})`, {
          tool: tool.name,
          error: lastError,
        })

        attempt++
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => {
            if (signal?.aborted) {
              resolve(undefined)
              return
            }
            resolve(undefined)
          })
          delay = Math.min(delay * 2, MAX_RETRY_DELAY)
        }
      }
    }

    return {
      success: false,
      error: lastError,
      output: `Error: ${lastError?.message || 'Unknown error'}`,
    }
  }
)

// Handle tool execution result
const handleResult = task(
  'handle_result',
  async (state: AgentState, result: ToolExecutionResult) => {
    const messages = [...state.messages]
    const observation = result.success ? result.output : `Error: ${result.error || 'Unknown error'}`
    messages.push(new AIMessage(observation))

    return {
      ...state,
      messages,
      observation,
    }
  }
)

/**
 * Tool executor that handles validation, retries, and error handling
 */
export const ToolExecutor = {
  async executeTool(
    state: AgentState,
    tool: Tool,
    input: string
  ): Promise<{ result: ToolExecutionResult; newState: AgentState }> {
    try {
      if (!tool || typeof tool.call !== 'function') {
        throw new Error('Invalid tool')
      }

      const validationResult = await validateInput(input)
      if (!validationResult.success || !validationResult.parsedInput) {
        const result: ToolExecutionResult = {
          success: false,
          output: `Input validation failed: ${validationResult.error?.message || 'Invalid input'}`,
          error: validationResult.error || new Error('Invalid input'),
        }
        const newState = await handleResult(state, result)
        return { result, newState }
      }

      const executionResult = await executeWithRetries(tool, validationResult.parsedInput)
      const result: ToolExecutionResult = {
        success: executionResult.success,
        output: executionResult.output,
        error: executionResult.error,
      }

      const newState = await handleResult(state, result)
      return { result, newState }
    } catch (error) {
      logger.error('Tool execution failed', { error, tool: tool.name, input })
      const result: ToolExecutionResult = {
        success: false,
        output: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }
      const newState = await handleResult(state, result)
      return { result, newState }
    }
  },
}
