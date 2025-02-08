import { expect, test, describe } from 'bun:test'
import { parseSections } from '@/lib/parse'

describe('Parse Library', () => {
  describe('parseSections', () => {
    test('should split content into sections by double newlines', () => {
      const content = `Section 1
content here

Section 2
more content

Section 3
final content`

      const sections = parseSections(content)
      expect(sections).toHaveLength(3)
      expect(sections[0]).toInclude('Section 1')
      expect(sections[1]).toInclude('Section 2')
      expect(sections[2]).toInclude('Section 3')
    })

    test('should handle single section', () => {
      const content = 'Single section\nwith content'
      const sections = parseSections(content)
      expect(sections).toHaveLength(1)
      expect(sections[0]).toBe(content)
    })

    test('should handle empty content', () => {
      const sections = parseSections('')
      expect(sections).toBeArray()
      expect(sections).toBeEmpty()
    })

    test('should handle multiple consecutive newlines', () => {
      const content = `Section 1


Section 2


Section 3`

      const sections = parseSections(content)
      expect(sections).toHaveLength(3)
      expect(sections[0]).toBe('Section 1')
      expect(sections[1]).toBe('Section 2')
      expect(sections[2]).toBe('Section 3')
    })

    test('should handle content with trailing newlines', () => {
      const content = `Section 1
content here

Section 2
more content

`
      const sections = parseSections(content)
      expect(sections).toHaveLength(2)
      expect(sections[0]).toInclude('Section 1')
      expect(sections[1]).toInclude('Section 2')
    })

    test('should handle content with leading newlines', () => {
      const content = `

Section 1
content here

Section 2
more content`

      const sections = parseSections(content)
      expect(sections).toHaveLength(2)
      expect(sections[0]).toInclude('Section 1')
      expect(sections[1]).toInclude('Section 2')
    })

    test('should preserve whitespace within sections', () => {
      const content = `Section 1
  indented content
\ttabbed content

Section 2
    more indented content`

      const sections = parseSections(content)
      expect(sections).toHaveLength(2)
      expect(sections[0]).toInclude('  indented content')
      expect(sections[0]).toInclude('\ttabbed content')
      expect(sections[1]).toInclude('    more indented content')
    })
  })
})
