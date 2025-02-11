import { createLLM } from '@/ai/llm'
import { TaskType } from '@/types'
import { getMessageString } from '@/ai/tasks/lib'
import { broadcast } from '@/stream'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { ReviewerTaskSchema } from '@/ai/tasks/schemas/tasks'
import type { RunnableConfig as LlamautomaConfig } from '@/types'

/**
 * Reviews generated code or plans to ensure they meet requirements
 */
export const reviewerTask = task(
  'reviewer',
  async (
    input: {
      messages: BaseMessage[]
      files: Record<string, string>
    },
    config: LlamautomaConfig
  ) => {
    // Update initial progress
    broadcast('Reviewing code...', 'progress')

    // Handle empty files object
    if (!input.files || Object.keys(input.files).length === 0) {
      const response = {
        content: 'No files provided for review.',
        type: 'review' as const,
        shouldDisplay: true,
        timestamp: Date.now(),
      }

      return ReviewerTaskSchema.parse({
        approved: false,
        feedback: 'No files provided for review.',
        suggestions: [],
        metrics: {
          quality: 0,
          coverage: 0,
          complexity: 0,
        },
        response,
      })
    }

    // Convert messages to string for context
    const context = input.messages.map(getMessageString).join('\n')

    // Generate review using LLM
    const prompt = `
      CONTEXT:
      ${context}

      FILES TO REVIEW:
      ${Object.entries(input.files)
        .map(([path, content]) => `FILE: ${path}\n\`\`\`\n${content}\n\`\`\``)
        .join('\n\n')}

      Review the code above and provide feedback. For each file, consider:
      1. Code quality and readability
      2. Error handling and edge cases
      3. Performance and efficiency
      4. Security considerations
      5. Testing and maintainability
      6. For CSS files:
         - Style organization and naming
         - Responsive design
         - Browser compatibility
         - Performance optimizations

      Your response MUST include:
      1. Overall assessment (approved/rejected)
      2. Detailed feedback for EACH file, including:
         - For TypeScript/JavaScript: Code structure, patterns, and practices
         - For CSS: Style organization, naming conventions, and responsive design
      3. Specific suggestions for improvement, formatted as follows:
         Category: Action to take
         Example: Security: Add input validation
    `

    const response = await createLLM(TaskType.Review, config.config).invoke([
      new HumanMessage(prompt),
    ])
    const responseContent =
      typeof response.content === 'string'
        ? response.content
        : typeof response.content === 'object' && 'text' in response.content
          ? String(response.content.text)
          : JSON.stringify(response.content)

    // Parse response into review format
    const approved = responseContent.toLowerCase().includes('approved')
    const feedback = responseContent.split('\n').slice(1).join('\n').trim()

    // Update progress with completion
    broadcast(`Review ${approved ? 'approved' : 'rejected'}`, 'chat')

    // Return result in expected schema format
    return ReviewerTaskSchema.parse({
      approved: approved,
      feedback: feedback,
      suggestions: extractSuggestions(feedback),
      metrics: {
        quality: 0,
        coverage: 0,
        complexity: 0,
      },
      response: {
        content: responseContent,
        type: 'review',
        shouldDisplay: true,
        timestamp: Date.now(),
      },
    })
  }
)

function extractSuggestions(feedback: string): Array<{
  step: string
  action: string
}> {
  // Handle empty or whitespace-only feedback
  if (!feedback || !feedback.trim()) {
    return []
  }

  const suggestions: Array<{ step: string; action: string }> = []
  const lines = feedback.split('\n')

  for (const line of lines) {
    // Match suggestions in format "Category: Action"
    const match = line.match(/^([^:]+):\s*(.+)$/i)
    if (match) {
      const [, step, action] = match
      suggestions.push({
        step: step.trim(),
        action: action.trim(),
      })
    }
  }

  return suggestions
}
