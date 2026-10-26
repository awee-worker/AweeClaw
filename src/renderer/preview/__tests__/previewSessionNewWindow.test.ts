/**
 * 页面新窗口请求测试
 *
 * 页面里的 target=_blank 链接与 window.open() 由主进程推回渲染进程，渲染侧按
 * guest id 认领：只有发起请求的那个预览标签页会新开标签页，其他标签页不受影响。
 * 这里把这两条边界固定下来，避免以后改成「广播给所有标签页」或「一律忽略」。
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { PreviewNewWindowRequest } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from '../previewSessionManager'

/** 主进程推下来的处理函数（service 在首次建会话时订阅一次） */
const handlers: Array<(request: PreviewNewWindowRequest) => void> = []

beforeAll(() => {
  vi.spyOn(api.preview, 'onNewWindow').mockImplementation(
    (handler: (request: PreviewNewWindowRequest) => void) => {
      handlers.push(handler)
      return () => {}
    },
  )
})

describe('页面新窗口请求', () => {
  it('按 guest id 认领请求并新开标签页', () => {
    const owner = previewSessionService.openUrl('http://127.0.0.1:15201/', { source: 'port-probe' })
    previewSessionService.setGuestId(owner.id, 7001)

    expect(handlers.length).toBeGreaterThan(0)
    handlers.forEach((handler) =>
      handler({ guestId: 7001, url: 'http://127.0.0.1:15202/detail' }),
    )

    const opened = previewSessionService
      .getState()
      .sessions.find((session) => session.url === 'http://127.0.0.1:15202/detail')

    expect(opened).toBeTruthy()
    expect(opened?.id).not.toBe(owner.id)
  })

  it('不是自己页面的请求不打开任何标签页', () => {
    const before = previewSessionService.getState().sessions.length

    handlers.forEach((handler) =>
      handler({ guestId: 999999, url: 'http://127.0.0.1:15203/other' }),
    )

    const opened = previewSessionService
      .getState()
      .sessions.find((session) => session.url === 'http://127.0.0.1:15203/other')

    expect(opened).toBeFalsy()
    expect(previewSessionService.getState().sessions.length).toBe(before)
  })
})
