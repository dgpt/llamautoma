import { z } from 'zod'
import { FileSchema } from './file'

/**
 * Schema for diff tool input
 */
export const DiffInputSchema = z.object({
  files: z.array(FileSchema).describe('Files to generate diffs for'),
})

/**
 * Schema for individual diff entry
 */
export const DiffEntrySchema = z.object({
  path: z.string().describe('Path of the file being diffed'),
  diff: z.array(z.tuple([z.number(), z.string()])).describe('Array of diff operations and content'),
  error: z.string().optional().describe('Optional error message if diff failed'),
})

/**
 * Schema for diff tool output
 */
export const DiffOutputSchema = z.array(DiffEntrySchema).describe('Array of file diffs')

export type DiffInput = z.infer<typeof DiffInputSchema>
export type DiffEntry = z.infer<typeof DiffEntrySchema>
export type DiffOutput = z.infer<typeof DiffOutputSchema>
