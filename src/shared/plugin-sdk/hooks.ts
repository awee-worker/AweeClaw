/**
 * Plugin SDK - Hook 系统实现
 *
 * 借鉴 OpenClaw 的 Hooks 架构，提供 before/after 钩子机制。
 * 支持优先级排序、异步执行、结果修改和流程中断。
 *
 * @module plugin-sdk/hooks
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { HookEventName, HookHandler, HookResult, HookRegistration } from './types'

// ============================================
// Hook 引擎
// ============================================

class HookEngine {
  /** 按事件分组的钩子注册列表 */
  private hooks = new Map<HookEventName, HookRegistration[]>()
  /** 全局事件监听器 */
  private listeners = new Set<(event: HookEventName, result: HookResult) => void>()

  /**
   * 注册钩子
   * @returns 取消注册的函数
   */
  register(
    event: HookEventName,
    handler: HookHandler,
    pluginId: string,
    priority = 100
  ): () => void {
    const id = `hook-${pluginId}-${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const registration: HookRegistration = { id, event, handler, pluginId, priority }

    if (!this.hooks.has(event)) {
      this.hooks.set(event, [])
    }

    const list = this.hooks.get(event)!
    list.push(registration)
    // 按优先级排序（数字越小优先级越高）
    list.sort((a, b) => a.priority - b.priority)

    logger.system.debug(`[HookEngine] Registered hook: ${id} (event=${event}, plugin=${pluginId}, priority=${priority})`)

    return () => {
      const idx = list.findIndex(r => r.id === id)
      if (idx >= 0) {
        list.splice(idx, 1)
        logger.system.debug(`[HookEngine] Unregistered hook: ${id}`)
      }
    }
  }

  /**
   * 触发钩子事件
   * 按优先级顺序执行所有已注册的钩子处理器。
   * - before-* 钩子：任一处理器返回 proceed=false 则中断
   * - after-* 钩子：所有处理器都会执行，但 proceed=false 的结果会被记录
   *
   * @returns 所有钩子执行结果的数组
   */
  async trigger(event: HookEventName, payload: unknown): Promise<HookResult[]> {
    const registrations = this.hooks.get(event)
    if (!registrations || registrations.length === 0) {
      return [{ proceed: true }]
    }

    const results: HookResult[] = []
    let currentPayload = payload

    for (const registration of registrations) {
      try {
        const result = await registration.handler(currentPayload)

        // before-* 钩子支持修改 payload
        if (result.modified !== undefined && event.startsWith('before-')) {
          currentPayload = result.modified
        }

        results.push(result)

        // 通知监听器
        for (const listener of this.listeners) {
          try { listener(event, result) } catch { /* ignore */ }
        }

        // before-* 钩子：proceed=false 则中断后续执行
        if (!result.proceed && event.startsWith('before-')) {
          logger.system.info(`[HookEngine] Hook chain interrupted by ${registration.pluginId} on event ${event}: ${result.reason || 'no reason'}`)
          break
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.system.error(`[HookEngine] Hook handler error: plugin=${registration.pluginId}, event=${event}, error=${errorMsg}`)
        results.push({ proceed: true }) // 处理器异常不中断链路
      }
    }

    return results
  }

  /**
   * 检查钩子链是否全部通过（所有 proceed=true）
   */
  async shouldProceed(event: HookEventName, payload: unknown): Promise<boolean> {
    const results = await this.trigger(event, payload)
    return results.every(r => r.proceed)
  }

  /**
   * 获取指定事件的已注册钩子列表
   */
  getRegistrations(event: HookEventName): HookRegistration[] {
    return this.hooks.get(event) || []
  }

  /**
   * 移除指定插件的所有钩子
   */
  removeByPlugin(pluginId: string): void {
    for (const [event, registrations] of this.hooks) {
      const filtered = registrations.filter(r => r.pluginId !== pluginId)
      if (filtered.length === 0) {
        this.hooks.delete(event)
      } else {
        this.hooks.set(event, filtered)
      }
    }
  }

  /**
   * 注册全局事件监听器
   */
  onEvent(listener: (event: HookEventName, result: HookResult) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 清理所有钩子
   */
  clear(): void {
    this.hooks.clear()
    this.listeners.clear()
  }
}

/** 全局 Hook 引擎实例 */
export const hookEngine = new HookEngine()
