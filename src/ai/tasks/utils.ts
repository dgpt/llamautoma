import { BaseMessage } from '@langchain/core/messages'

// Helper to safely get message content as string
export function getMessageString(msg: BaseMessage): string {
  const content = msg.content
  if (typeof content === 'string') {
    return content
  } else if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && 'text' in item) return item.text
        return ''
      })
      .join(' ')
  }
  return ''
}
