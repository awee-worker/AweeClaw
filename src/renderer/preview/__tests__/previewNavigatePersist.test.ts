/**
 * 预览导航的持久化写入测试
 *
 * 覆盖一个真实踩过的坑：页面自身重载（或 webview 重挂载后的 did-navigate 回执）
 * 会让 navigate 拿到与当前会话完全相同的地址，早期实现照样回写工作区元数据，
 * 于是 openFiles 被换成新对象、触发工作区状态落盘；落盘文件一旦位于预览根目录内，
 * 自动刷新监听又会把页面拉一次，形成「重载 → 落盘 → 重载」的自持回环，
 * 表现为内置浏览器不停刷新，会话结束后也停不下来。
 *
 * 这里把「地址没变不写元数据 / 地址变了要写」这条边界固定下来。
 * 用例之间用不同端口隔离：previewSessionService 是单例，状态会跨用例累积。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { previewSessionService } from '../previewSessionManager'
import { useStore } from '@store'

describe('预览导航的持久化写入', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('地址未变化（页面自身重载）时不回写工作区元数据', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15191/', {
      source: 'port-probe',
    })
    const spy = vi.spyOn(useStore.getState(), 'updatePreviewMetadata')

    previewSessionService.navigate(session.id, session.url)

    expect(spy).not.toHaveBeenCalled()
    // 内存态的加载状态仍要更新，刷新链路与状态提示都依赖它
    expect(previewSessionService.getSession(session.id)?.status).toBe('loading')
  })

  it('地址变化时回写工作区元数据', () => {
    const session = previewSessionService.openUrl('http://127.0.0.1:15192/', {
      source: 'port-probe',
    })
    const spy = vi.spyOn(useStore.getState(), 'updatePreviewMetadata')

    previewSessionService.navigate(session.id, 'http://127.0.0.1:15192/about')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(previewSessionService.getSession(session.id)?.url).toBe('http://127.0.0.1:15192/about')
  })
})
