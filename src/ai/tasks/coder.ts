import { task } from '@langchain/langgraph'
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { CoderTaskSchema, ReviewerTaskSchema } from './schemas/tasks'
import { z } from 'zod'
import { llm } from '../llm'
import { getMessageString } from '../tasks/lib'
import { broadcastProgress, broadcastMessage } from '../../stream'
import { logger } from '@/logger'
import type { RunnableConfig as LlamautomaConfig } from '@/types'

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
 * Attempts to extract and parse JSON from a string that may contain other content
 */
function extractAndParseJson(text: string): any {
  // First, try to parse the entire text as JSON
  try {
    const result = JSON.parse(text)
    if (typeof result === 'object' && result !== null && 'files' in result) {
      return result
    }
  } catch (error) {
    logger.debug('Failed to parse entire text as JSON, attempting to extract JSON object')
  }

  // Try to find JSON objects in the text using a more robust regex
  const matches = Array.from(
    text.matchAll(
      /(?:(?<=\n)|^)\s*(\{(?:[^{}]|(?:\{[^{}]*\}))*\}|\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\])\s*(?=\n|$)/gm
    )
  )
  if (!matches.length) {
    // Try a more lenient regex that might catch malformed JSON
    const lenientMatches = Array.from(text.matchAll(/\{[^]*?\}/g))
    if (!lenientMatches.length) {
      logger.error('No JSON object found in response')
      throw new Error('No JSON object found in response')
    }
    matches.push(...lenientMatches)
  }

  // Try each potential JSON object, starting with the largest
  const potentialJsons = matches.map(m => m[1] || m[0]).sort((a, b) => b.length - a.length)

  for (const json of potentialJsons) {
    try {
      // Clean up the JSON string more thoroughly
      const cleanJson = json
        .replace(/```(?:json)?\s*|\s*```/g, '') // Remove code blocks
        .replace(/`/g, '') // Remove backticks
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        .replace(/\n(?!\s*["\]}])/g, '\\n') // Fix unescaped newlines
        .replace(/\r/g, '\\r') // Fix unescaped carriage returns
        .replace(/\t/g, '\\t') // Fix unescaped tabs
        .replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\') // Fix invalid escapes
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\/\/.*/g, '') // Remove line comments
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Quote unquoted keys
        .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single quotes to double quotes
        .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas more aggressively
        .replace(/\\n\s*([}\]])/g, '$1') // Remove newlines before closing brackets
        .replace(/([{,])\s*\\n\s*/g, '$1') // Remove newlines after opening brackets and commas
        .replace(/\\/g, '\\\\') // Escape all backslashes
        .replace(/\\\\/g, '\\') // Fix double escaped backslashes
        .trim()

      // Try to parse with a fallback structure
      let result
      try {
        result = JSON.parse(cleanJson)
      } catch (parseError) {
        // If parsing fails, try to create a minimal valid structure
        const fileMatches = cleanJson.match(/["']path["']\s*:\s*["']([^"']+)["']/g)
        if (fileMatches) {
          result = {
            files: fileMatches.map(match => ({
              path: match.match(/["']([^"']+)["']/)?.[1] || '',
              content: '',
              type: 'create',
            })),
          }
        } else {
          throw parseError
        }
      }

      // Validate and normalize the structure
      if (typeof result === 'object' && result !== null) {
        // Ensure files array exists and has required properties
        if (!Array.isArray(result.files)) {
          if (typeof result.files === 'object' && result.files !== null) {
            // Convert object to array if necessary
            result.files = Object.entries(result.files).map(([path, content]) => ({
              path,
              content: typeof content === 'string' ? content : '',
              type: 'create',
            }))
          } else {
            result.files = []
          }
        }

        // Normalize each file entry
        result.files = result.files.map((file: any) => ({
          path: file.path || '',
          content: typeof file.content === 'string' ? file.content : '',
          type: file.type || 'create',
          description: file.description,
          language: file.language,
        }))

        // Ensure dependencies is an array if present
        if (result.dependencies && !Array.isArray(result.dependencies)) {
          result.dependencies = []
        }

        // Ensure stats object if present
        if (result.stats && typeof result.stats === 'object') {
          result.stats = {
            totalFiles: result.files.length,
            totalLines: result.files.reduce(
              (acc: number, file: any) => acc + (file.content.match(/\n/g)?.length || 0) + 1,
              0
            ),
            filesChanged: result.files.map((f: any) => f.path),
            ...result.stats,
          }
        }

        return result
      }

      logger.debug('Found JSON object but missing required structure:', result)
    } catch (error) {
      logger.debug('Failed to parse potential JSON:', error)
      // Continue to next potential JSON if this one fails
      continue
    }
  }

  logger.error('No valid JSON object found in response')
  throw new Error('No valid JSON object found in response')
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
    config?: LlamautomaConfig
  ) => {
    // Update initial progress
    await broadcastProgress('Generating code...', config?.configurable)

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
8. NEVER include any explanatory text or comments in your response
9. ONLY output the JSON object, nothing else
10. ALL file content MUST be properly escaped with \\n for newlines
11. ALL quotes MUST be properly escaped
12. ALL special characters MUST be properly escaped

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

    const response = await llm.invoke([new SystemMessage(prompt)])
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
      metadata: config?.configurable,
    })

    // Return result in expected schema format
    return CoderTaskSchema.parse({
      files: result.files,
      dependencies: result.dependencies,
      stats: result.stats,
      response: {
        content: `Generated ${result.files.length} file(s)`,
        type: 'code',
        shouldDisplay: true,
        priority: 75,
        timestamp: Date.now(),
      },
    })
  }
)
