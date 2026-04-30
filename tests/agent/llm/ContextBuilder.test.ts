/**
 * ContextBuilder 测试
 * 测试上下文构建逻辑
 */

import { describe, it, expect } from 'vitest'
import { buildUserContent } from '@renderer/agent/llm/ContextBuilder'

describe('ContextBuilder', () => {
  describe('buildUserContent', () => {
    it('should build simple text content', () => {
      const result = buildUserContent('Hello', '')
      expect(result).toBe('Hello')
    })

    it('should include context when provided', () => {
      const result = buildUserContent('Question', '## File: test.ts\nconst x = 1;')
      expect(typeof result === 'string' ? result : JSON.stringify(result)).toContain('test.ts')
    })

    it('should handle array content', () => {
      const result = buildUserContent([{ type: 'text', text: 'Hello' }], '')
      expect(Array.isArray(result)).toBe(true)
    })

    it('should combine message and context', () => {
      const result = buildUserContent('What is this?', '## Context\nSome context')
      expect(result).toBeDefined()
    })
  })

  describe('Context Formatting', () => {
    it('should format file context', () => {
      const context = '## File: src/main.ts\ncode here'
      const result = buildUserContent('Question', context)
      expect(result).toBeDefined()
    })

    it('should handle empty context', () => {
      const result = buildUserContent('Question', '')
      expect(result).toBe('Question')
    })

    it('should handle multiple context items', () => {
      const context = '## File: a.ts\ncode1\n\n## File: b.ts\ncode2'
      const result = buildUserContent('Question', context)
      expect(result).toBeDefined()
    })
  })
})
