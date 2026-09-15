/**
 * VTS 联动 IPC 处理器（主进程）
 *
 * 通道清单：
 * - vts:get-config | update-config | reset-config   配置读写（token 由 VtsStore 加密落盘）
 * - vts:connect | disconnect | reconnect            连接生命周期
 * - vts:get-status                                  运行状态（连接态 / 帧统计 / 表情热键清单）
 * - vts:refresh-data                                重新拉取模型表情与热键
 * - vts:trigger                                     按名字触发（表情优先，回退热键）
 * - vts:push-audio                                  推入 TTS 音频（主口型通道）
 * - vts:push-volume                                 按音量驱动（降级通道）
 * - vts:clear-audio                                 中断口型（用户点「停止」）
 * - vts:self-test                                   合成正弦波自测（验收用，不依赖 TTS）
 *
 * 事件推送：`vts:status`（连接状态变化 / 模型数据更新），由 preload 侧订阅。
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` / `{ success:false, error }`。
 *
 * @module vts/VtsIpc
 */

import { Buffer } from 'buffer'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getVtsManager } from './VtsManager'
import { getConfig, resetConfig, validateConfig } from './VtsStore'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 允许的音频 MIME 前缀（只放行音频，避免把任意二进制喂给 ffmpeg） */
const AUDIO_MIME_PATTERN = /^audio\/[a-z0-9.+-]+$/i

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/**
 * 把渲染层传来的音频载荷归一化成 Buffer。
 *
 * IPC 走 structured clone，Uint8Array 到主进程后仍是 Uint8Array 的克隆
 * （不是 Buffer 实例），因此必须显式转换 —— 直接当 Buffer 用会丢方法。
 * 同时兼容 ArrayBuffer 形态（部分调用方直接传 arrayBuffer() 的产物）。
 */
function toBuffer(payload: unknown): Buffer | null {
  if (!payload) return null
  if (Buffer.isBuffer(payload)) return payload
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (payload instanceof ArrayBuffer) return Buffer.from(payload)
  // Node 侧 ArrayBuffer 与渲染侧可能跨 realm，用鸭子类型兜底
  if (typeof payload === 'object' && 'byteLength' in (payload as object)) {
    try {
      return Buffer.from(payload as ArrayBuffer)
    } catch {
      return null
    }
  }
  return null
}

/** 注册 VTS 联动 IPC（幂等） */
export function registerVtsIpc(): void {
  if (registered) return
  registered = true

  const manager = getVtsManager()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('vts:get-config', async () => {
    const config = getConfig()
    return { success: true, data: { config, issues: validateConfig(config) } }
  })

  safeIpcHandle('vts:update-config', async (_event, patch: unknown) => {
    try {
      const config = await manager.applyConfig(patch)
      return { success: true, data: { config, issues: validateConfig(config) } }
    } catch (err) {
      logger.system.error('[VTS] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('vts:reset-config', async () => {
    try {
      // reset 会清掉 token（等于撤销授权），因此必须跟着断开
      resetConfig()
      await manager.disconnect()
      const config = await manager.applyConfig({})
      return { success: true, data: { config, issues: validateConfig(config) } }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 连接生命周期
  // --------------------------------------------
  safeIpcHandle('vts:connect', async () => {
    try {
      await manager.connect()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.warn('[VTS] connect failed:', err)
      // 连接失败是常态（VTS 没开），返回可读消息给 UI，而非抛异常
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vts:disconnect', async () => {
    try {
      await manager.disconnect()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('vts:reconnect', async () => {
    try {
      await manager.reconnect()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 状态与模型数据
  // --------------------------------------------
  safeIpcHandle('vts:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  safeIpcHandle('vts:refresh-data', async () => {
    manager.refreshModelData()
    return { success: true, data: manager.getStatus() }
  })

  safeIpcHandle('vts:trigger', async (_event, name: unknown) => {
    const raw = typeof name === 'string' ? name.trim() : ''
    if (!raw) return { success: false, error: 'name is required' }
    const hit = manager.trigger(raw)
    return { success: true, data: { triggered: hit } }
  })

  // 从整段回复里提取 <名字> 标签并依次触发。
  // 放在主进程而不是渲染层：标签解析规则（strip 尖括号 + 忽略大小写 + 表情优先）
  // 与触发表单是同一套语义，拆到两侧迟早会漂移。
  safeIpcHandle('vts:trigger-text', async (_event, text: unknown) => {
    const raw = typeof text === 'string' ? text : ''
    if (!raw) return { success: true, data: { hits: [] } }
    const hits = manager.triggerFromText(raw)
    return { success: true, data: { hits } }
  })

  // --------------------------------------------
  // 口型驱动
  // --------------------------------------------
  safeIpcHandle('vts:push-audio', async (_event, payload: unknown, mimeType: unknown) => {
    const buffer = toBuffer(payload)
    if (!buffer || !buffer.length) return { success: false, error: 'audio payload is empty' }

    const mime = typeof mimeType === 'string' && AUDIO_MIME_PATTERN.test(mimeType) ? mimeType : undefined

    try {
      const queued = await manager.pushAudio(buffer, mime)
      return { success: true, data: { queued } }
    } catch (err) {
      // 转码失败（后端返回了非音频内容 / ffmpeg 异常）不该刷 error 级日志
      logger.system.warn('[VTS] push-audio failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('vts:push-volume', async (_event, volume: unknown) => {
    const value = typeof volume === 'number' && Number.isFinite(volume) ? volume : 0
    manager.pushVolume(value)
    return { success: true }
  })

  safeIpcHandle('vts:clear-audio', async () => {
    manager.clearAudio()
    return { success: true, data: manager.getStatus() }
  })

  // --------------------------------------------
  // 自测
  // --------------------------------------------
  safeIpcHandle('vts:self-test', async (_event, durationMs: unknown) => {
    const duration = typeof durationMs === 'number' && durationMs > 0 ? Math.min(durationMs, 10_000) : 1500
    try {
      const queued = await manager.selfTest(duration)
      return { success: true, data: { queued } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
