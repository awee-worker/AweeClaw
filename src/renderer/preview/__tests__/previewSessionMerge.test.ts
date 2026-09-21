/**
 * 预览标签页合并策略测试
 *
 * 两条边界恰好相反，最容易在后续改动里被改错，因此固定下来：
 * - 服务类预览（dev server）：同 host:port 复用同一个标签页，地址变化走导航
 * - 本地文件预览：同目录下的多个页面各自保有标签页
 *
 * 用例之间用不同端口隔离：previewSessionService 是单例，状态会跨用例累积。
 */

import { describe, it, expect } from 'vitest'
import { previewSessionService } from '../previewSessionManager'

describe('预览标签页合并策略', () => {
  it('服务类预览：同 host:port 的再次打开走导航，不新建标签页', () => {
    const first = previewSessionService.openUrl('http://127.0.0.1:15173/', {
      source: 'port-probe',
      candidateId: 'c1',
    })
    const second = previewSessionService.openUrl('http://127.0.0.1:15173/about', {
      source: 'port-probe',
      candidateId: 'c1',
    })

    expect(second.id).toBe(first.id)
    expect(previewSessionService.getSession(first.id)?.url).toBe('http://127.0.0.1:15173/about')
  })

  it('服务类预览：不同 host:port 各自独立', () => {
    const a = previewSessionService.openUrl('http://127.0.0.1:15174/', { source: 'port-probe' })
    const b = previewSessionService.openUrl('http://127.0.0.1:15175/', { source: 'port-probe' })

    expect(b.id).not.toBe(a.id)
  })

  it('本地文件预览：同目录的不同页面各自独立', () => {
    const a = previewSessionService.openUrl('http://127.0.0.1:15176/a.html', {
      previewRoot: '/tmp/preview-site',
    })
    const b = previewSessionService.openUrl('http://127.0.0.1:15176/b.html', {
      previewRoot: '/tmp/preview-site',
    })

    expect(b.id).not.toBe(a.id)
  })

  it('forceNew 时同源也不合并（新建标签页入口）', () => {
    const a = previewSessionService.openUrl('http://127.0.0.1:15177/', { source: 'port-probe' })
    const b = previewSessionService.openUrl('http://127.0.0.1:15177/', {
      source: 'port-probe',
      forceNew: true,
    })

    expect(b.id).not.toBe(a.id)
  })
})
