/**
 * safeExternalUrl 单元测试
 *
 * 覆盖 URL 协议白名单校验、Markdown 残留清理、边界输入
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron shell
vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

// Mock logger
vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    security: { warn: vi.fn() },
    system: { warn: vi.fn() },
  },
}))

import { isUrlAllowed, safeOpenExternal } from '@main/guard/safeExternalUrl'
import { shell } from 'electron'

describe('isUrlAllowed', () => {
  it('应允许 https 协议', () => {
    expect(isUrlAllowed('https://example.com')).toBe(true)
    expect(isUrlAllowed('https://github.com/user/repo')).toBe(true)
  })

  it('应允许 http 协议', () => {
    expect(isUrlAllowed('http://localhost:3000')).toBe(true)
    expect(isUrlAllowed('http://127.0.0.1:8080/api')).toBe(true)
  })

  it('应允许 mailto 协议', () => {
    expect(isUrlAllowed('mailto:test@example.com')).toBe(true)
  })

  it('应允许 devtools:// 协议', () => {
    expect(isUrlAllowed('devtools://devtools/bundled/inspector.html')).toBe(true)
  })

  it('应拒绝 file:// 协议', () => {
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false)
    expect(isUrlAllowed('file:///C:/Windows/System32')).toBe(false)
  })

  it('应拒绝 javascript: 协议', () => {
    expect(isUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isUrlAllowed('javascript:void(0)')).toBe(false)
  })

  it('应拒绝 data: 协议', () => {
    expect(isUrlAllowed('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('应拒绝 ftp:// 协议', () => {
    expect(isUrlAllowed('ftp://evil.com/malware')).toBe(false)
  })

  it('应拒绝空字符串', () => {
    expect(isUrlAllowed('')).toBe(false)
  })

  it('应拒绝非字符串输入', () => {
    expect(isUrlAllowed(null as any)).toBe(false)
    expect(isUrlAllowed(undefined as any)).toBe(false)
    expect(isUrlAllowed(123 as any)).toBe(false)
  })

  it('应拒绝无效 URL', () => {
    expect(isUrlAllowed('not-a-url')).toBe(false)
  })

  it('应清理 Markdown 残留符号', () => {
    expect(isUrlAllowed('**https://example.com**')).toBe(true)
    expect(isUrlAllowed('__https://example.com__')).toBe(true)
    expect(isUrlAllowed('~~https://example.com~~')).toBe(true)
    expect(isUrlAllowed('`https://example.com`')).toBe(true)
  })

  it('清理后为空时应拒绝', () => {
    expect(isUrlAllowed('****')).toBe(false)
    expect(isUrlAllowed('``')).toBe(false)
  })
})

describe('safeOpenExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应打开允许的 https URL', async () => {
    const result = await safeOpenExternal('https://example.com')
    expect(result).toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('应拒绝不允许的协议', async () => {
    const result = await safeOpenExternal('file:///etc/passwd')
    expect(result).toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('应拒绝空 URL', async () => {
    const result = await safeOpenExternal('')
    expect(result).toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('应拒绝非字符串输入', async () => {
    const result = await safeOpenExternal(null as any)
    expect(result).toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('应清理 Markdown 残留后打开', async () => {
    const result = await safeOpenExternal('**https://example.com**')
    expect(result).toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })
})
