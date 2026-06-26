/**
 * 桌面自动化模式全局状态缓存
 *
 * 作用：提供同步读取的自动化模式激活状态，供 AgentSubLoop 等非 React 上下文使用。
 * 当自动化模式激活时，工具批准流程需从聊天卡片切换为 globalDecide 弹窗，
 * 因为用户在自动化模式下无法操作聊天界面。
 *
 * 生命周期：由 AweeApp 在启动时调用 subscribeAutomationModeState() 订阅主进程状态变更，
 * 应用退出时调用 unsubscribeAutomationModeState() 取消订阅。
 */

import { api } from '../adapters/electronBridge'
import { logger } from './LogEngine'

/** 自动化模式状态 */
let automationActive = false

/** 状态变更监听器列表 */
const listeners: Array<(active: boolean) => void> = []

/** IPC 取消订阅函数 */
let unsubscribe: (() => void) | null = null

/**
 * 同步读取自动化模式是否激活
 * 供 AgentSubLoop.executeToolCall 等非 React 上下文调用
 */
export function isAutomationModeActive(): boolean {
  return automationActive
}

/**
 * 订阅自动化模式状态变更
 * 应在应用启动时（AweeApp.tsx）调用一次
 */
export async function subscribeAutomationModeState(): Promise<void> {
  if (unsubscribe) return // 防止重复订阅

  try {
    // 同步初始状态
    const res = await api.desktop.automation.getState()
    if (res.success && res.data) {
      automationActive = !!res.data.active
      logger.desktop?.info?.(`[AutomationModeState] Initial state: active=${automationActive}`)
    }

    // 订阅后续变更
    unsubscribe = api.desktop.automation.onStateChange((state: { active: boolean }) => {
      const newActive = !!state?.active
      if (newActive !== automationActive) {
        automationActive = newActive
        logger.desktop?.info?.(`[AutomationModeState] State changed: active=${automationActive}`)
        // 通知所有监听器
        for (const listener of listeners) {
          try {
            listener(automationActive)
          } catch (err) {
            logger.desktop?.warn?.('[AutomationModeState] Listener error:', err)
          }
        }
      }
    })
  } catch (err) {
    logger.desktop?.warn?.('[AutomationModeState] Failed to subscribe:', err)
  }
}

/**
 * 取消订阅自动化模式状态变更
 * 应在应用退出时调用
 */
export function unsubscribeAutomationModeState(): void {
  if (unsubscribe) {
    try {
      unsubscribe()
    } catch {
      // 忽略取消订阅错误
    }
    unsubscribe = null
  }
}

/**
 * 注册状态变更监听器
 * @returns 取消注册函数
 */
export function onAutomationModeChange(listener: (active: boolean) => void): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}
