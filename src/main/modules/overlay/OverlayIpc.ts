/**
 * 悬浮层 IPC 处理器（主进程）
 *
 * 通道清单：
 * - overlay:get-config | update-config | reset-config      配置读写
 * - overlay:get-status                                     运行状态（端口 / 连接数 / OBS 地址）
 * - overlay:set-enabled                                    总开关
 * - overlay:show-subtitle                                  推送一条字幕（AI 回复）
 * - overlay:push-danmaku                                   推送一条弹幕事件
 * - overlay:clear                                          清空
 * - overlay:show-window | hide-window | toggle-window      应用内窗口显隐
 * - overlay:set-window-mode                                切换形态（subtitle / danmaku）
 * - overlay:set-click-through                              鼠标穿透开关
 * - overlay:open-external-url                              用系统浏览器打开（自测用）
 * - overlay:copy-text                                      复制地址到剪贴板（OBS 配置用）
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，返回值统一为 { success, data } / { success:false, error }。
 *
 * @module overlay/OverlayIpc
 */

import { clipboard, shell } from 'electron'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getOverlayManager } from './OverlayManager'
import { getConfig, resetConfig, updateConfig } from './OverlayStore'
import type { DanmuType, OverlayEventPayload, OverlayMode } from './types'

/** 是否已注册（safeIpcHandle 幂等，但显式挡一层更清晰） */
let registered = false

/** 注册悬浮层 IPC（幂等） */
export function registerOverlayIpc(): void {
  if (registered) return
  registered = true

  const manager = getOverlayManager()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('overlay:get-config', async () => {
    return { success: true, data: getConfig() }
  })

  safeIpcHandle('overlay:update-config', async (_event, patch: unknown) => {
    try {
      const next = await manager.applyConfig(patch)
      return { success: true, data: next }
    } catch (err) {
      logger.system.error('[Overlay] update-config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('overlay:reset-config', async () => {
    try {
      const next = resetConfig()
      const applied = await manager.applyConfig(next)
      return { success: true, data: applied }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('overlay:set-enabled', async (_event, enabled: unknown) => {
    try {
      const next = await manager.setEnabled(Boolean(enabled))
      return { success: true, data: next }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 状态
  // --------------------------------------------
  safeIpcHandle('overlay:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  // --------------------------------------------
  // 推送
  // --------------------------------------------
  safeIpcHandle('overlay:show-subtitle', async (_event, content: unknown) => {
    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) return { success: false, error: 'content is required' }
    const delivered = manager.pushSubtitle(text)
    return { success: true, data: { delivered } }
  })

  safeIpcHandle('overlay:push-danmaku', async (_event, payload: unknown) => {
    const raw = (payload ?? {}) as Partial<OverlayEventPayload>
    const content = typeof raw.content === 'string' ? raw.content.trim() : ''
    if (!content) return { success: false, error: 'content is required' }

    const delivered = manager.pushEvent({
      id: raw.id ?? '',
      type: 'message',
      content,
      danmu_type: (raw.danmu_type ?? 'danmaku') as DanmuType,
      platform: raw.platform ?? 'local',
      ts: raw.ts ?? Date.now(),
    })
    return { success: true, data: { delivered } }
  })

  safeIpcHandle('overlay:clear', async () => {
    manager.clear()
    return { success: true, data: { ok: true } }
  })

  // --------------------------------------------
  // 应用内窗口
  // --------------------------------------------
  safeIpcHandle('overlay:show-window', async () => {
    const win = manager.getWindow()
    if (!win.isCreated()) {
      await manager.applyConfig({ windowEnabled: true })
    }
    win.show()
    return { success: true, data: { visible: win.isVisible() } }
  })

  safeIpcHandle('overlay:hide-window', async () => {
    const win = manager.getWindow()
    win.hide()
    return { success: true, data: { visible: win.isVisible() } }
  })

  safeIpcHandle('overlay:toggle-window', async () => {
    const win = manager.getWindow()
    if (!win.isCreated()) {
      await manager.applyConfig({ windowEnabled: true })
      win.show()
      return { success: true, data: { visible: true } }
    }
    win.toggle()
    return { success: true, data: { visible: win.isVisible() } }
  })

  safeIpcHandle('overlay:set-window-mode', async (_event, mode: unknown) => {
    const next: OverlayMode = mode === 'danmaku' ? 'danmaku' : 'subtitle'
    manager.getWindow().setMode(next)
    updateConfig({ windowMode: next })
    return { success: true, data: { mode: next } }
  })

  safeIpcHandle('overlay:set-click-through', async (_event, clickThrough: unknown) => {
    const value = Boolean(clickThrough)
    manager.getWindow().setClickThrough(value)
    updateConfig({ window: { clickThrough: value } })
    return { success: true, data: { clickThrough: value } }
  })

  // --------------------------------------------
  // 辅助（OBS 配置体验）
  // --------------------------------------------
  safeIpcHandle('overlay:open-external-url', async (_event, url: unknown) => {
    const target = typeof url === 'string' ? url : ''
    // 只允许本机地址，避免 IPC 被滥用成任意链接打开器
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target)) {
      return { success: false, error: 'only local url is allowed' }
    }
    await shell.openExternal(target)
    return { success: true, data: { opened: target } }
  })

  safeIpcHandle('overlay:copy-text', async (_event, text: unknown) => {
    const value = typeof text === 'string' ? text : ''
    if (!value) return { success: false, error: 'text is required' }
    clipboard.writeText(value)
    return { success: true, data: { copied: value } }
  })
}
