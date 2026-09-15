/**
 * 直播互动 IPC 处理器（主进程）
 *
 * 通道清单：
 * - live:get-config | update-config | reset-config   配置读写（凭证由 LiveStore 加密落盘）
 * - live:set-enabled                                 总开关
 * - live:start | stop | reload                       生命周期
 * - live:get-status                                  运行状态（连接态 / 事件计数 / 最近事件）
 * - live:push-test                                   合成一条事件走完整链路（验收自测）
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` / `{ success:false, error }`。
 *
 * @module live/LiveIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { createLiveEvent, getLiveEventBus } from './LiveEventBus'
import { getLiveManager } from './LiveManager'
import { getConfig, resetConfig, validateConfig } from './LiveStore'
import type { LiveDanmuType, LivePlatform } from './types'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 允许的弹幕类型（IPC 入参校验，避免脏数据流到悬浮层） */
const VALID_DANMU_TYPES: ReadonlySet<string> = new Set<string>([
  'danmaku',
  'gift',
  'buy_guard',
  'super_chat',
  'enter_room',
  'follow',
  'like',
])

/** 允许的平台标识 */
const VALID_PLATFORMS: ReadonlySet<string> = new Set<string>(['bilibili', 'youtube', 'twitch'])

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册直播互动 IPC（幂等） */
export function registerLiveIpc(): void {
  if (registered) return
  registered = true

  const manager = getLiveManager()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('live:get-config', async () => {
    const config = getConfig()
    return { success: true, data: { config, issues: validateConfig(config) } }
  })

  safeIpcHandle('live:update-config', async (_event, patch: unknown) => {
    try {
      const config = await manager.applyConfig(patch)
      return { success: true, data: { config, issues: validateConfig(config) } }
    } catch (err) {
      logger.system.error('[Live] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('live:reset-config', async () => {
    try {
      resetConfig()
      // reset 后必须重跑编排：把已连接的平台按默认（全关）配置停掉
      const config = await manager.applyConfig({})
      return { success: true, data: { config, issues: validateConfig(config) } }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('live:set-enabled', async (_event, enabled: unknown) => {
    try {
      const config = await manager.setEnabled(Boolean(enabled))
      return { success: true, data: { config, issues: validateConfig(config) } }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 生命周期
  // --------------------------------------------
  safeIpcHandle('live:start', async () => {
    try {
      await manager.start()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.error('[Live] start failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('live:stop', async () => {
    try {
      await manager.stop()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('live:reload', async () => {
    try {
      await manager.reload()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.error('[Live] reload failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 状态
  // --------------------------------------------
  safeIpcHandle('live:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  // --------------------------------------------
  // 自测：合成事件走完整链路（总线 → 悬浮层 + 渲染层）
  // --------------------------------------------
  safeIpcHandle('live:push-test', async (_event, payload: unknown) => {
    const raw = (payload ?? {}) as { content?: unknown; danmu_type?: unknown; platform?: unknown }

    const content = typeof raw.content === 'string' ? raw.content.trim() : ''
    if (!content) return { success: false, error: 'content is required' }

    const danmuType = (
      typeof raw.danmu_type === 'string' && VALID_DANMU_TYPES.has(raw.danmu_type)
        ? raw.danmu_type
        : 'danmaku'
    ) as LiveDanmuType

    const platform = (
      typeof raw.platform === 'string' && VALID_PLATFORMS.has(raw.platform) ? raw.platform : 'bilibili'
    ) as LivePlatform

    const delivered = getLiveEventBus().publish(createLiveEvent(platform, danmuType, content, { test: true }))
    return { success: true, data: { delivered } }
  })
}
