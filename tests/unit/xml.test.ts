import { expect, test, describe } from 'bun:test'
import {
  parseXMLContent,
  validateXMLResponse,
  validateXMLTypes,
  formatXMLResponse,
  formatToolResponse,
  formatCodeResponse,
  formatEditResponse,
  formatFileResponse,
  isSimpleXMLContent,
  isToolXMLContent,
  isCodeXMLContent,
  isEditXMLContent,
  isFileXMLContent,
  isXMLResponse,
  isToolResponse,
  isSimpleXMLResponse,
  isCodeXMLResponse,
  isEditXMLResponse,
  isFileXMLResponse,
  isRecord,
  stringifyXMLContent,
  ResponseType,
  XMLContent,
  ToolXMLContent,
  CodeXMLContent,
  EditXMLContent,
  FileXMLContent,
} from '@/xml'

describe('XML Module Tests', () => {
  describe('Type Guards', () => {
    test('isSimpleXMLContent', () => {
      expect(isSimpleXMLContent('simple string')).toBe(true)
      expect(isSimpleXMLContent({ path: 'not simple', content: 'test' } as XMLContent)).toBe(false)
      expect(isSimpleXMLContent(null as unknown as XMLContent)).toBe(false)
      expect(isSimpleXMLContent(undefined as unknown as XMLContent)).toBe(false)
    })

    test('isToolXMLContent', () => {
      const validTool: ToolXMLContent = {
        thought: 'thinking',
        action: 'test',
        args: { key: 'value' },
      }
      expect(isToolXMLContent(validTool)).toBe(true)
      expect(isToolXMLContent({ thought: 'missing fields' } as XMLContent)).toBe(false)
      expect(isToolXMLContent(null as unknown as XMLContent)).toBe(false)
      expect(isToolXMLContent('string' as XMLContent)).toBe(false)
    })

    test('isCodeXMLContent', () => {
      const validCode: CodeXMLContent = {
        language: 'typescript',
        code: 'const x = 1;',
      }
      expect(isCodeXMLContent(validCode)).toBe(true)
      expect(isCodeXMLContent({ language: 'missing code' } as XMLContent)).toBe(false)
      expect(isCodeXMLContent(null as unknown as XMLContent)).toBe(false)
      expect(isCodeXMLContent('string' as XMLContent)).toBe(false)
    })

    test('isEditXMLContent', () => {
      const validEdit: EditXMLContent = {
        file: 'test.ts',
        changes: [
          {
            type: 'insert' as const,
            location: '1',
            content: 'new line',
          },
        ],
      }
      expect(isEditXMLContent(validEdit)).toBe(true)
      expect(isEditXMLContent({ file: 'missing changes' } as XMLContent)).toBe(false)
      expect(isEditXMLContent(null as unknown as XMLContent)).toBe(false)
      expect(isEditXMLContent('string' as XMLContent)).toBe(false)
    })

    test('isFileXMLContent', () => {
      const validFile: FileXMLContent = {
        path: 'test.ts',
        content: 'file content',
      }
      expect(isFileXMLContent(validFile)).toBe(true)
      expect(isFileXMLContent({ path: 'missing content' } as XMLContent)).toBe(false)
      expect(isFileXMLContent(null as unknown as XMLContent)).toBe(false)
      expect(isFileXMLContent('string' as XMLContent)).toBe(false)
    })

    test('isXMLResponse', () => {
      const validResponse = {
        type: 'chat' as ResponseType,
        content: 'test content',
        raw: '<response type="chat"><content>test content</content></response>',
      }
      expect(isXMLResponse(validResponse)).toBe(true)
      expect(isXMLResponse({ type: 'invalid' })).toBe(false)
      expect(isXMLResponse(null)).toBe(false)
      expect(isXMLResponse('string')).toBe(false)
    })

    test('isToolResponse', () => {
      const validTool = {
        thought: 'thinking',
        action: 'test',
        args: { key: 'value' },
      }
      expect(isToolResponse(validTool)).toBe(true)
      expect(isToolResponse({ thought: 'missing fields' })).toBe(false)
      expect(isToolResponse(null)).toBe(false)
      expect(isToolResponse('string')).toBe(false)
    })

    test('isRecord', () => {
      expect(isRecord({ key: 'value' })).toBe(true)
      expect(isRecord([])).toBe(false)
      expect(isRecord(null)).toBe(false)
      expect(isRecord('string')).toBe(false)
      expect(isRecord(123)).toBe(false)
    })
  })

  describe('Response Type Checks', () => {
    test('isSimpleXMLResponse', () => {
      const validResponse = {
        type: 'chat' as ResponseType,
        content: 'test content',
        raw: '<response type="chat"><content>test content</content></response>',
      }
      expect(isSimpleXMLResponse(validResponse)).toBe(true)

      const invalidResponse = {
        type: 'tool' as ResponseType,
        content: { thought: 'test', action: 'test', args: {} },
        raw: '<response type="tool"></response>',
      }
      expect(isSimpleXMLResponse(invalidResponse)).toBe(false)
    })

    test('isCodeXMLResponse', () => {
      const validResponse = {
        type: 'code' as ResponseType,
        content: { language: 'typescript', code: 'const x = 1;' },
        raw: '<response type="code"></response>',
      }
      expect(isCodeXMLResponse(validResponse)).toBe(true)

      const invalidResponse = {
        type: 'chat' as ResponseType,
        content: 'test content',
        raw: '<response type="chat"></response>',
      }
      expect(isCodeXMLResponse(invalidResponse)).toBe(false)
    })

    test('isEditXMLResponse', () => {
      const validResponse = {
        type: 'edit' as ResponseType,
        content: {
          file: 'test.ts',
          changes: [{ type: 'insert' as const, location: '1', content: 'new line' }],
        },
        raw: '<response type="edit"></response>',
      }
      expect(isEditXMLResponse(validResponse)).toBe(true)

      const invalidResponse = {
        type: 'chat' as ResponseType,
        content: 'test content',
        raw: '<response type="chat"></response>',
      }
      expect(isEditXMLResponse(invalidResponse)).toBe(false)
    })

    test('isFileXMLResponse', () => {
      const validResponse = {
        type: 'compose' as ResponseType,
        content: { path: 'test.ts', content: 'file content' },
        raw: '<response type="compose"></response>',
      }
      expect(isFileXMLResponse(validResponse)).toBe(true)

      const invalidResponse = {
        type: 'chat' as ResponseType,
        content: 'test content',
        raw: '<response type="chat"></response>',
      }
      expect(isFileXMLResponse(invalidResponse)).toBe(false)
    })
  })

  describe('XML Parsing and Validation', () => {
    test('parseXMLContent with simple response', () => {
      const xml = '<response type="chat"><content>test message</content></response>'
      const result = parseXMLContent(xml)
      expect(result).toBeDefined()
      expect(result?.type).toBe('chat')
      expect(result?.content).toBe('test message')
    })

    test('parseXMLContent with tool response', () => {
      const xml = `
        <response type="tool">
          <thought>thinking</thought>
          <action>test</action>
          <args>{"key":"value"}</args>
        </response>
      `
      const result = parseXMLContent(xml)
      expect(result).toBeDefined()
      if (result) {
        expect(result.type).toBe('tool')
        expect(isToolXMLContent(result.content)).toBe(true)
      }
    })

    test('parseXMLContent with code response', () => {
      const xml = `
        <response type="code">
          <language>typescript</language>
          <code>const x = 1;</code>
        </response>
      `
      const result = parseXMLContent(xml)
      expect(result).toBeDefined()
      if (result) {
        expect(result.type).toBe('code')
        expect(isCodeXMLContent(result.content)).toBe(true)
      }
    })

    test('parseXMLContent with edit response', () => {
      const xml = `
        <response type="edit">
          <file>test.ts</file>
          <changes>
            <change type="insert">
              <location>1</location>
              <content>new line</content>
            </change>
          </changes>
        </response>
      `
      const result = parseXMLContent(xml)
      expect(result).toBeDefined()
      if (result) {
        expect(result.type).toBe('edit')
        expect(isEditXMLContent(result.content)).toBe(true)
      }
    })

    test('parseXMLContent with file response', () => {
      const xml = `
        <response type="compose">
          <file>
            <path>test.ts</path>
            <content>file content</content>
          </file>
        </response>
      `
      const result = parseXMLContent(xml)
      expect(result).toBeDefined()
      if (result) {
        expect(result.type).toBe('compose')
        expect(isFileXMLContent(result.content)).toBe(true)
      }
    })

    test('parseXMLContent with invalid XML', () => {
      const xml = 'invalid xml'
      const result = parseXMLContent(xml)
      expect(result).toBeNull()
    })

    test('validateXMLResponse', () => {
      const validXml = '<response type="chat"><content>test</content></response>'
      expect(validateXMLResponse(validXml, 'chat')).toBe(true)

      const invalidXml = '<response type="chat">missing content tag</response>'
      expect(validateXMLResponse(invalidXml, 'chat')).toBe(false)

      const wrongType = '<response type="tool"><content>test</content></response>'
      expect(validateXMLResponse(wrongType, 'chat')).toBe(false)
    })

    test('validateXMLTypes', () => {
      const xml = '<response type="chat"><content>test</content></response>'
      expect(validateXMLTypes(xml, ['chat', 'thought'])).toBe(true)
      expect(validateXMLTypes(xml, ['tool'])).toBe(false)
      expect(validateXMLTypes('invalid xml', ['chat'])).toBe(false)
    })
  })

  describe('XML Formatting', () => {
    test('formatXMLResponse', () => {
      const result = formatXMLResponse('chat', 'test message')
      expect(result).toContain('<response type="chat">')
      expect(result).toContain('<content>test message</content>')
    })

    test('formatToolResponse', () => {
      const result = formatToolResponse('thinking', 'test', { key: 'value' })
      expect(result).toContain('<response type="tool">')
      expect(result).toContain('<thought>thinking</thought>')
      expect(result).toContain('<action>test</action>')
      expect(result).toContain('<args>')
    })

    test('formatCodeResponse', () => {
      const result = formatCodeResponse('typescript', 'const x = 1;')
      expect(result).toContain('<response type="code">')
      expect(result).toContain('<language>typescript</language>')
      expect(result).toContain('<code>const x = 1;</code>')
    })

    test('formatEditResponse', () => {
      const result = formatEditResponse('test.ts', [
        { type: 'insert' as const, location: '1', content: 'new line' },
      ])
      expect(result).toContain('<response type="edit">')
      expect(result).toContain('<file>test.ts</file>')
      expect(result).toContain('<changes>')
    })

    test('formatFileResponse', () => {
      const result = formatFileResponse('compose', 'test.ts', 'file content')
      expect(result).toContain('<response type="compose">')
      expect(result).toContain('<path>test.ts</path>')
      expect(result).toContain('<content>file content</content>')
    })
  })

  describe('Content Stringification', () => {
    test('stringifyXMLContent with simple content', () => {
      expect(stringifyXMLContent('simple string')).toBe('simple string')
    })

    test('stringifyXMLContent with tool content', () => {
      const toolContent = {
        thought: 'thinking',
        action: 'test',
        args: { key: 'value' },
      }
      const result = stringifyXMLContent(toolContent)
      expect(JSON.parse(result)).toEqual(toolContent)
    })

    test('stringifyXMLContent with code content', () => {
      const codeContent = {
        language: 'typescript',
        code: 'const x = 1;',
      }
      const result = stringifyXMLContent(codeContent)
      expect(JSON.parse(result)).toEqual(codeContent)
    })

    test('stringifyXMLContent with edit content', () => {
      const editContent: EditXMLContent = {
        file: 'test.ts',
        changes: [{ type: 'insert' as const, location: '1', content: 'new line' }],
      }
      const result = stringifyXMLContent(editContent)
      expect(JSON.parse(result)).toEqual(editContent)
    })

    test('stringifyXMLContent with file content', () => {
      const fileContent = {
        path: 'test.ts',
        content: 'file content',
      }
      const result = stringifyXMLContent(fileContent)
      expect(JSON.parse(result)).toEqual(fileContent)
    })
  })
})
