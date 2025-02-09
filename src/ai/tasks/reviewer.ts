import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { broadcastProgress, broadcastMessage } from '../../stream'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { task } from '@langchain/langgraph'
import { ReviewerTaskSchema } from './schemas/tasks'
import { z } from 'zod'
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
    config?: LlamautomaConfig
  ) => {
    // Update initial progress
    broadcastProgress('Reviewing code...', config?.configurable)

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

      Review the code above and provide feedback. Consider:
      1. Code quality and readability
      2. Error handling and edge cases
      3. Performance and efficiency
      4. Security considerations
      5. Testing and maintainability

      Respond with:
      1. Overall assessment (approved/rejected)
      2. Detailed feedback
      3. Specific suggestions for improvement
    `

    const response = await llm.invoke([new HumanMessage(prompt)])
    const responseContent =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

    // Parse response into review format
    const approved = responseContent.toLowerCase().includes('approved')
    const feedback = responseContent.split('\n').slice(1).join('\n').trim()

    // Update progress with completion
    broadcastMessage(`Review ${approved ? 'approved' : 'rejected'}`, config?.configurable)

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
        priority: 75,
        timestamp: Date.now(),
      },
    })
  }
)

function extractSuggestions(feedback: string): Array<{ step: string; action: string }> {
  const suggestions: Array<{ step: string; action: string }> = []
  const lines = feedback.split('\n')

  for (const line of lines) {
    const match = line.match(/^(\d+\.\s*|\-\s*)(.*?):\s*(.*)$/)
    if (match) {
      suggestions.push({
        step: match[2].trim(),
        action: match[3].trim(),
      })
    }
  }

  return suggestions
}

// Schema for reviewer output
const ReviewerOutputSchema = z.object({
  approved: z.boolean().describe('Whether the code or plan meets requirements'),
  feedback: z.string().describe('Detailed feedback about the code or plan'),
  suggestions: z
    .array(
      z.object({
        step: z.string().describe('The area or component to improve'),
        action: z.string().describe('What needs to be done'),
        priority: z.enum(['high', 'medium', 'low']).describe('Priority of the suggestion'),
      })
    )
    .describe('Specific suggestions for improvement')
    .optional(),
  metrics: z
    .object({
      quality: z.number().min(0).max(100).describe('Overall code quality score'),
      coverage: z.number().min(0).max(100).describe('Test coverage score'),
      complexity: z.number().min(0).max(100).describe('Code complexity score'),
    })
    .describe('Quantitative metrics about the code')
    .optional(),
})
