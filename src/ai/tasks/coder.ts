import { task } from '@langchain/langgraph'
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { CoderTaskSchema, ReviewerTaskSchema } from './schemas/tasks'
import { z } from 'zod'
import { createLLM } from '../llm'
import { getMessageString } from '../tasks/lib'
import { broadcastProgress, broadcastMessage } from '../../stream'
import { logger } from '@/logger'
import { TaskType } from '@/types'
import type { RunnableConfig } from '@/types'

/**
 * Parses file sections into structured format
 */
function parseFiles(sections: string[]): Array<{
  path: string
  content: string
  type: 'create' | 'modify' | 'delete'
  description?: string
}> {
  const files = []
  let currentFile: {
    path: string
    content: string
    type: 'create' | 'modify' | 'delete'
    description?: string
  } | null = null

  for (const section of sections) {
    if (section.startsWith('File:') || section.startsWith('Path:')) {
      if (currentFile) {
        files.push(currentFile)
      }
      const [pathLine, ...contentLines] = section.split('\n')
      const path = pathLine.split(':')[1].trim()
      currentFile = {
        path,
        content: '',
        type: 'create',
      }
    } else if (section.startsWith('Description:')) {
      if (currentFile) {
        currentFile.description = section.split(':')[1].trim()
      }
    } else if (currentFile) {
      currentFile.content = section
    }
  }

  if (currentFile) {
    files.push(currentFile)
  }

  return files
}

/**
 * Extracts and parses JSON from LLM response
 */
function extractAndParseJson(text: string): any {
  try {
    // Try to parse the entire text as JSON first
    return JSON.parse(text)
  } catch (e) {
    // If that fails, try to find JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON object found in response')
    }
    try {
      return JSON.parse(jsonMatch[0])
    } catch (e) {
      throw new Error('Failed to parse JSON from response')
    }
  }
}

/**
 * Generates code based on the plan and user requirements
 */
export const coderTask = task(
  'coder',
  async (
    input: {
      messages: BaseMessage[]
      plan: string
      review?: z.infer<typeof ReviewerTaskSchema>
    },
    config?: RunnableConfig
  ) => {
    if (!config?.config) {
      throw new Error('Config is required for coder task')
    }

    // Create LLM instance
    const llm = createLLM(TaskType.Code, config.config)

    // Update initial progress
    await broadcastProgress('Generating code...', config.config.configurable)

    // Convert messages to string for context
    const context = input.messages.map(getMessageString).join('\n')

    // Generate code using LLM
    const prompt = `You are a code generation assistant tasked with implementing code based on requirements.

CONTEXT:
${context}

PLAN:
${input.plan}

${
  input.review
    ? `REVIEW FEEDBACK:
${input.review.feedback}

SUGGESTIONS FOR IMPROVEMENT:
${input.review.suggestions?.map(suggestion => `- ${suggestion.step}: ${suggestion.action}`).join('\n')}

You MUST incorporate the above feedback and suggestions into your response.`
    : ''
}

Based on the above context and plan, generate the necessary code.
You MUST respond with ONLY a JSON object containing:
1. "files" (array) - list of files to create/modify/delete:
   - "path" (string) - path to the file
   - "content" (string) - content of the file
   - "type" (create|update|delete) - type of operation
   - "description" (string, optional) - description of changes
   - "language" (string, optional) - programming language
2. "dependencies" (array, optional) - list of dependencies:
   - "name" (string) - package name
   - "version" (string) - version constraint
   - "type" (required|optional|dev) - dependency type
3. "stats" (object, optional) - code statistics:
   - "totalFiles" (number) - total number of files
   - "totalLines" (number) - total lines of code
   - "filesChanged" (array) - list of changed files

IMPORTANT:
1. Do NOT include any text before or after the JSON object
2. Do NOT use markdown code blocks or backticks
3. Ensure all JSON is properly formatted and escaped
4. All file paths must be valid and use forward slashes
5. All file content must be properly escaped with \\n for newlines
6. File operation type must be exactly "create", "update", or "delete"
7. If review feedback is provided, ensure your response addresses ALL suggestions

Example response:
{
  "files": [
    {
      "path": "src/components/Counter.tsx",
      "content": "import React, { useState } from 'react';\\n\\nexport const Counter = () => {\\n  const [count, setCount] = useState(0);\\n\\n  return (\\n    <div>\\n      <h1>Count: {count}</h1>\\n      <button onClick={() => setCount(count + 1)}>+</button>\\n      <button onClick={() => setCount(count - 1)}>-</button>\\n    </div>\\n  );\\n};",
      "type": "create",
      "description": "React counter component with TypeScript",
      "language": "typescript"
    }
  ],
  "dependencies": [
    {
      "name": "react",
      "version": "^18.0.0",
      "type": "required"
    }
  ],
  "stats": {
    "totalFiles": 1,
    "totalLines": 15,
    "filesChanged": ["src/components/Counter.tsx"]
  }
}`

    const response = await llm.invoke([new SystemMessage(prompt)], config)
    const responseContent =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

    // Try to parse the response as JSON
    let result
    try {
      result = extractAndParseJson(responseContent)

      // Convert any 'modify' types to 'update'
      if (result.files) {
        result.files = result.files.map((file: any) => ({
          ...file,
          type: file.type === 'modify' ? 'update' : file.type,
        }))
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to parse coder response:', error)
      throw new Error(`Failed to parse coder response: ${errorMessage}`)
    }

    // Update progress with completion
    await broadcastMessage({
      type: 'code',
      content: `Generated ${result.files.length} file(s)`,
      timestamp: Date.now(),
    })

    // Return result in expected schema format
    return CoderTaskSchema.parse({
      files: result.files,
      dependencies: result.dependencies,
      stats: result.stats,
      response: {
        content: responseContent,
        type: 'code',
        shouldDisplay: true,
        timestamp: Date.now(),
      },
    })
  }
)
