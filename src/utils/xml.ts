export const formatXMLResponse = (type: string, content: string): string => {
  return `<${type}>${content}</${type}>`
}
