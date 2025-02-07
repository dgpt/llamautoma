import { z } from 'zod'

/**
 * Schema for file operations
 */
export const FileSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe('File content'),
  type: z.enum(['create', 'update', 'delete']).describe('Operation type'),
  description: z.string().optional().describe('Description of file purpose'),
})

export type File = z.infer<typeof FileSchema>
