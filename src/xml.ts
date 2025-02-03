import { z } from 'zod'

export interface XMLResponse {
  type: string
  content: string
  raw: string
}

export interface ToolResponse {
  thought: string
  action: string
  args: Record<string, unknown>
}

export const ResponseTypeSchema = z.enum([
  'thought',
  'chat',
  'error',
  'warning',
  'tool',
  'observation',
  'final',
  'code',
  'edit',
  'compose',
  'sync',
  'confirmation',
  'feedback',
])

export type ResponseType = z.infer<typeof ResponseTypeSchema>

export function parseXMLContent(content: string): XMLResponse | null {
  const xmlMatch = content.match(/<response type="([^"]+)">(.*?)<\/response>/s)
  if (!xmlMatch) return null

  const type = xmlMatch[1]
  const innerContent = xmlMatch[2]
  let parsedContent: string = innerContent

  // Extract content based on response type
  switch (type) {
    case 'thought':
    case 'chat':
    case 'error':
    case 'warning':
      const contentMatch = innerContent.match(/<content>(.*?)<\/content>/s)
      parsedContent = contentMatch ? contentMatch[1] : innerContent
      break
    case 'tool':
      const thoughtMatch = innerContent.match(/<thought>(.*?)<\/thought>/s)
      const actionMatch = innerContent.match(/<action>(.*?)<\/action>/s)
      const argsMatch = innerContent.match(/<args>(.*?)<\/args>/s)
      parsedContent = JSON.stringify({
        thought: thoughtMatch ? thoughtMatch[1] : '',
        action: actionMatch ? actionMatch[1] : '',
        args: argsMatch ? argsMatch[1] : '{}',
      })
      break
    case 'observation':
      const obsMatch = innerContent.match(/<content>(.*?)<\/content>/s)
      parsedContent = obsMatch ? obsMatch[1] : innerContent
      break
    case 'final':
      const summaryMatch = innerContent.match(/<content>(.*?)<\/content>/s)
      parsedContent = summaryMatch ? summaryMatch[1] : innerContent
      break
    case 'code':
      const langMatch = innerContent.match(/<language>(.*?)<\/language>/s)
      const codeMatch = innerContent.match(/<code>(.*?)<\/code>/s)
      parsedContent = JSON.stringify({
        language: langMatch ? langMatch[1] : '',
        code: codeMatch ? codeMatch[1] : '',
      })
      break
  }

  return {
    type,
    content: parsedContent,
    raw: content,
  }
}

export function validateXMLResponse(content: string, type: string): boolean {
  const xmlContent = content
  switch (type) {
    case 'thought':
    case 'chat':
    case 'error':
    case 'warning':
      return xmlContent.includes('<content>') && xmlContent.includes('</content>')
    case 'tool':
      return (
        xmlContent.includes('<thought>') &&
        xmlContent.includes('</thought>') &&
        xmlContent.includes('<action>') &&
        xmlContent.includes('</action>') &&
        xmlContent.includes('<args>') &&
        xmlContent.includes('</args>')
      )
    case 'observation':
      return xmlContent.includes('<content>') && xmlContent.includes('</content>')
    case 'final':
      return xmlContent.includes('<content>') && xmlContent.includes('</content>')
    case 'code':
      return (
        xmlContent.includes('<language>') &&
        xmlContent.includes('</language>') &&
        xmlContent.includes('<code>') &&
        xmlContent.includes('</code>')
      )
    default:
      return false
  }
}

export function validateXMLTypes(content: string, types: string[]): boolean {
  const xmlData = parseXMLContent(content)
  if (!xmlData) return false
  return types.includes(xmlData.type)
}

export function formatXMLResponse(type: ResponseType, content: string): string {
  const escapedContent = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

  return `<response type="${type}"><content>${escapedContent}</content></response>`
}

export function formatToolResponse(
  thought: string,
  action: string,
  args: Record<string, unknown>
): string {
  return `<response type="tool">
  <thought>${thought}</thought>
  <action>${action}</action>
  <args>${JSON.stringify(args)}</args>
</response>`
}

export function formatCodeResponse(language: string, code: string): string {
  return `<response type="code">
  <language>${language}</language>
  <code>${code}</code>
</response>`
}
