/**
 * 预览标签页 guest 重报入口测试
 *
 * 背景：主进程的浏览器自动化（browser_snapshot 等）靠「webview 主动上报 guest」
 * 建立关联。上报挂在 dom-ready 上，一旦早于事件监听注册或绑定被中途解绑，主进程
 * 就没有该会话的记录，AI 报「No preview tab found」。打开预览的场景可在等待窗口
 * 内主动请求重报来兜底，这里把该入口的行为固定下来。
 */

import { describe, it, expect } from 'vitest'
import { previewSessionService } from '../previewSessionManager'

describe('预览标签页 guest 重报入口', () => {
  it('按 sessionId 命中对应标签页的回调', () => {
    let aCalls = 0
    let bCalls = 0
    const offA = previewSessionService.registerGuestReporter('gr-a', () => {
      aCalls++
      return true
    })
    const offB = previewSessionService.registerGuestReporter('gr-b', () => {
      bCalls++
      return true
    })

    expect(previewSessionService.requestGuestReport('gr-a')).toBe(true)
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(0)

    offA()
    offB()
  })

  it('不传 sessionId 时触发全部已登记标签页', () => {
    let aCalls = 0
    let bCalls = 0
    const offA = previewSessionService.registerGuestReporter('gr-all-a', () => {
      aCalls++
      return true
    })
    const offB = previewSessionService.registerGuestReporter('gr-all-b', () => {
      bCalls++
      return true
    })

    expect(previewSessionService.requestGuestReport()).toBe(true)
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(1)

    offA()
    offB()
  })

  it('注销后不再触发', () => {
    let calls = 0
    const off = previewSessionService.registerGuestReporter('gr-off', () => {
      calls++
      return true
    })

    off()
    // 目标不存在，且该回调已注销：不应触发，也不应误报为已投递
    expect(previewSessionService.requestGuestReport('gr-off')).toBe(false)
    expect(calls).toBe(0)
  })

  it('webview 尚未就绪（回调返回 false）时不算投递成功', () => {
    const off = previewSessionService.registerGuestReporter('gr-notready', () => false)

    expect(previewSessionService.requestGuestReport('gr-notready')).toBe(false)

    off()
  })

  it('单个回调抛错不影响其余标签页', () => {
    let goodCalls = 0
    const offBad = previewSessionService.registerGuestReporter('gr-throw', () => {
      throw new Error('webview detached')
    })
    const offGood = previewSessionService.registerGuestReporter('gr-good', () => {
      goodCalls++
      return true
    })

    expect(previewSessionService.requestGuestReport()).toBe(true)
    expect(goodCalls).toBe(1)

    offBad()
    offGood()
  })
})
