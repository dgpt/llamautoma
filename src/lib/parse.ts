/**
 * Splits a response into sections based on double newlines
 */
export function parseSections(content: string): string[] {
  return content.split('\n\n').filter(Boolean)
}
