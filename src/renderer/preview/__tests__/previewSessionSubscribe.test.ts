/**
 * 会话订阅通知测试
 *
 * 覆盖一个真实踩过的坑：subscribe 只写了退订逻辑、没把监听器加入通知集合，
 * emit 于是遍历一个空集合 —— 刷新令牌、健康快照、加载状态全部推不到组件，
 * 表现就是「点了刷新没反应」「状态灯一直是灰的」。这里把通知链路固定下来。
 *
 * 用例之间用不同端口隔离：previewSessionService 是单例，状态会跨用例累积。
 */

import { describe, it, expect } from 'vitest'
import { previewSessionService } from '../previewSessionManager'
import type { PreviewHealthSnapshot } from '@shared/protocols/previewProtocol'

/** 构造一份最小可用的健康快照 */
function snapshotFor(sessionId: string, url: string): PreviewHealthSnapshot {
  return {
    sessionId,
    level: 'healthy',
    url,
    consoleMessages: [],
    loadFailures: [],
    blank: false,
    crashed: false,
    errorCount: 0,
    updatedAt: Date.now(),
  }
}

describe('预览会话订阅通知', () => {
  it('订阅时立即同步一次当前状态', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15181/', {
      source: 'port-probe',
    })

    let calls = 0
    const unsubscribe = previewSessionService.subscribe(() => {
      calls++
    })

    expect(calls).toBe(1)
    expect(previewSessionService.getState().sessions.some((item) => item.id === session.id)).toBe(
      true,
    )

    unsubscribe()
  })

  it('刷新令牌推进后通知订阅者，且状态里带着新令牌', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15182/', {
      source: 'port-probe',
    })

    const tokens: number[] = []
    const unsubscribe = previewSessionService.subscribe((state) => {
      tokens.push(state.sessions.find((item) => item.id === session.id)?.reloadToken ?? -1)
    })

    previewSessionService.reload(session.id)

    // 订阅回调里必须能读到推进后的令牌，否则刷新链路会静默断掉
    expect(tokens[tokens.length - 1]).toBe(1)
    expect(previewSessionService.getSession(session.id)?.reloadToken).toBe(1)

    unsubscribe()
  })

  it('健康快照写入后通知订阅者，且会话上带着 health', () => {
    const url = 'http://127.0.0.1:15183/'
    const session = previewSessionService.openUrl(url, { source: 'port-probe' })

    let latest = previewSessionService.getSession(session.id)
    const unsubscribe = previewSessionService.subscribe((state) => {
      latest = state.sessions.find((item) => item.id === session.id) ?? latest
    })

    previewSessionService.applyHealth(snapshotFor(session.id, url))

    expect(latest?.health?.sessionId).toBe(session.id)
    expect(latest?.health?.level).toBe('healthy')

    unsubscribe()
  })

  it('退订后不再收到通知', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15184/', {
      source: 'port-probe',
    })

    let calls = 0
    const unsubscribe = previewSessionService.subscribe(() => {
      calls++
    })

    expect(calls).toBe(1)
    unsubscribe()

    previewSessionService.reload(session.id)

    expect(calls).toBe(1)
  })
})
