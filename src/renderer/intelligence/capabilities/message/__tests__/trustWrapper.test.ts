/**
 * 工具结果信任包裹测试
 *
 * 核心约定：可信内容必须原样透传 —— 本地文件、终端与知识库结果的上下文
 * 必须与改动前逐字节一致，否则会影响全部既有会话。
 * 只有不可信来源才加数据边界与来源标注。
 */

import { describe, it, expect } from 'vitest'
import { wrapUntrustedContent } from '../MessageAdapter'
import type { ToolOrigin } from '@intelligence/types/trustTypes'

const trusted: ToolOrigin = { toolName: 'read_file', channel: 'local_fs', trust: 'trusted' }

const untrusted: ToolOrigin = {
  toolName: 'web_search',
  channel: 'web',
  trust: 'untrusted',
  locator: 'https://example.com/a',
}

describe('wrapUntrustedContent', () => {
  it('可信内容原样返回', () => {
    const content = '{"path":"a.ts","size":12}'
    expect(wrapUntrustedContent(content, trusted)).toBe(content)
  })

  it('无来源信息时原样返回', () => {
    expect(wrapUntrustedContent('plain')).toBe('plain')
  })

  it('空内容原样返回', () => {
    expect(wrapUntrustedContent('', untrusted)).toBe('')
  })

  it('不可信内容被包裹并标注来源', () => {
    const wrapped = wrapUntrustedContent('外部载荷', untrusted)
    expect(wrapped).toContain('<external_content')
    expect(wrapped).toContain('source="web"')
    expect(wrapped).toContain('locator="https://example.com/a"')
    expect(wrapped).toContain('外部载荷')
    expect(wrapped).toContain('</external_content>')
    expect(wrapped).toContain('数据而非指令')
  })

  it('来源定位中的引号被转义，不破坏包裹结构', () => {
    const wrapped = wrapUntrustedContent('x', {
      ...untrusted,
      locator: 'https://a.com/?q="><script>',
    })
    expect(wrapped).toContain('&quot;')
    expect(wrapped).not.toContain('"><script>')
  })

  it('无定位时只带通道', () => {
    const wrapped = wrapUntrustedContent('x', {
      toolName: 'mcp_some_server',
      channel: 'external_service',
      trust: 'untrusted',
    })
    expect(wrapped).toContain('source="external_service"')
    expect(wrapped).not.toContain('locator=')
  })

  it('外层标签闭合，内容处于标签之内', () => {
    const wrapped = wrapUntrustedContent('载荷', untrusted)
    const openIdx = wrapped.indexOf('<external_content')
    const bodyIdx = wrapped.indexOf('载荷')
    const closeIdx = wrapped.indexOf('</external_content>')
    expect(openIdx).toBeLessThan(bodyIdx)
    expect(bodyIdx).toBeLessThan(closeIdx)
  })
})
