/**
 * Splits a response into sections based on double newlines
 */
export function parseSections(content: string): string[] {
  return content
    .split(/\n{2,}/) // Split on 2 or more newlines
    .map(section => section.trim()) // Trim whitespace
    .filter(Boolean) // Remove empty sections
}
