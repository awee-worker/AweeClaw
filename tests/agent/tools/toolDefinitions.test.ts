/**
 * 工具定义测试
 * 测试工具注册和验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  toolRegistry,
  initializeToolProviders,
} from '@intelligence/toolkit'
import { TOOL_SCHEMAS, TOOL_CONFIGS } from '@configuration/tools'
import { resolveEditFileRequest } from '@toolkit/fileEditor'

// Mock dependencies that tools need
vi.mock('@services/WorkspaceManager', () => ({
  workspaceManager: {
    getCurrentWorkspacePath: vi.fn(() => '/test/workspace'),
  },
}))

vi.mock('@renderer/agent/core/Agent', () => ({
  Agent: {
    hasValidFileCache: vi.fn(() => false),
  },
}))

describe('Tool Definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initializeToolProviders()
  })

  describe('Tool Schemas', () => {
    it('should have TOOL_SCHEMAS object', () => {
      expect(TOOL_SCHEMAS).toBeDefined()
      expect(typeof TOOL_SCHEMAS).toBe('object')
    })

    it('should have TOOL_CONFIGS object', () => {
      expect(TOOL_CONFIGS).toBeDefined()
      expect(typeof TOOL_CONFIGS).toBe('object')
    })

    it('should have read_file in configs', () => {
      expect(TOOL_CONFIGS.read_file).toBeDefined()
      expect(TOOL_CONFIGS.read_file.name).toBe('read_file')
    })

    it('should have edit_file in configs', () => {
      expect(TOOL_CONFIGS.edit_file).toBeDefined()
      expect(TOOL_CONFIGS.edit_file.name).toBe('edit_file')
    })

    it('should have run_command in configs', () => {
      expect(TOOL_CONFIGS.run_command).toBeDefined()
      expect(TOOL_CONFIGS.run_command.name).toBe('run_command')
    })

    it('should generate schemas from configs', () => {
      // TOOL_SCHEMAS should have same keys as TOOL_CONFIGS
      const configKeys = Object.keys(TOOL_CONFIGS)
      const schemaKeys = Object.keys(TOOL_SCHEMAS)
      
      expect(schemaKeys.length).toBeGreaterThan(0)
      // At least some configs should have schemas
      expect(schemaKeys.length).toBeGreaterThanOrEqual(configKeys.length * 0.5)
    })

    it('should allow read_file path arrays', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      const result = readFileSchema.safeParse({
        path: ['src/a.ts', 'src/b.ts'],
      })

      expect(result.success).toBe(true)
    })

    it('should reject inverted line ranges in read_file', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      const result = readFileSchema.safeParse({
        path: 'src/main.ts',
        start_line: 20,
        end_line: 10,
      })

      expect(result.success).toBe(false)
    })

    // 说明：edit_file 的 schema 只校验「形状与类型」，不再做模式判定与字段清理。
    // 模式判定放在 resolveEditFileRequest 里，因为它需要在 schema 拦截之前
    // 把「该用哪个模式」的完整指引回传给模型；放 schema 层只会剩下一行 Validation failed。

    it('should accept placeholder line fields and empty edits in edit_file string mode', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'portal/src/pages/dashboard/DocsPage.tsx',
        old_string: 'const a = 1',
        new_string: 'const a = 2',
        start_line: 1,
        end_line: 1,
        content: '',
        replace_all: false,
        edits: [],
      })

      expect(result.success).toBe(true)
      // 形如占位符的字段由解析层清理，最终落到字符串模式
      const resolution = resolveEditFileRequest(result.data as Record<string, unknown>)
      expect(resolution.ok).toBe(true)
      if (resolution.ok) expect(resolution.mode).toBe('string')
    })

    it('should accept a line-mode call carrying empty string fields', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: '',
        new_string: '',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
        edits: [],
      })

      expect(result.success).toBe(true)
      const resolution = resolveEditFileRequest(result.data as Record<string, unknown>)
      expect(resolution.ok).toBe(true)
      if (resolution.ok) expect(resolution.mode).toBe('line')
    })

    it('should not reject mixed edit_file modes at the schema level', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: 'before',
        new_string: 'after',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
      })

      // schema 放行 —— 混用不再是一次调用失败，而是被解析成最具体的一种模式
      expect(result.success).toBe(true)
      const resolution = resolveEditFileRequest(result.data as Record<string, unknown>)
      expect(resolution.ok).toBe(true)
      if (resolution.ok) {
        expect(resolution.mode).toBe('string')
        expect(resolution.notes?.join(' ')).toContain('ignored')
      }
    })

    it('should resolve to line mode when batch fields are only empty mirrored placeholders', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'app/page.tsx',
        content: 'export default function HomePage() {\n  return null\n}',
        edits: [
          {
            action: 'replace',
            start_line: 1,
            end_line: 356,
            content: '',
          },
        ],
        start_line: 1,
        end_line: 356,
        old_string: '',
        new_string: '',
        replace_all: false,
      })

      expect(result.success).toBe(true)
      const resolution = resolveEditFileRequest(result.data as Record<string, unknown>)
      expect(resolution.ok).toBe(true)
      if (resolution.ok) expect(resolution.mode).toBe('line')
    })

    it('should coerce string line numbers in edit_file arguments', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        start_line: '3',
        end_line: '4',
        content: 'const updated = true',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.start_line).toBe(3)
        expect(result.data.end_line).toBe(4)
      }
    })
  })

  describe('toolRegistry', () => {
    it('should have registry methods', () => {
      expect(typeof toolRegistry.register).toBe('function')
      expect(typeof toolRegistry.get).toBe('function')
      expect(typeof toolRegistry.has).toBe('function')
      expect(typeof toolRegistry.validate).toBe('function')
    })

    it('should validate using schemas', () => {
      // Test that schemas can be used for validation
      const readFileSchema = TOOL_SCHEMAS.read_file
      if (readFileSchema) {
        const validResult = readFileSchema.safeParse({ path: 'src/main.ts' })
        expect(validResult.success).toBe(true)
        
        const invalidResult = readFileSchema.safeParse({})
        expect(invalidResult.success).toBe(false)
      }
    })
  })
})
