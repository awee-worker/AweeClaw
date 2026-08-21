/**
 * PluginHostBridge — 插件 UI 与客户端内部能力的桥接器
 *
 * 职责：
 * 监听插件通过 PluginHostApi 派发的 window CustomEvent，将其转译为
 * 客户端内部 API 调用。本组件是插件与客户端解耦的关键边界——
 * 插件只依赖 host API（不 import 客户端内部模块），实际能力由本组件代理。
 *
 * 当前桥接能力：
 * - sendChatMessage：插件请求向当前会话发送消息 → 调用 useAgentActions().sendMessage
 *
 * 本组件不渲染任何 UI，仅在挂载时注册监听、卸载时清理。
 * 必须挂载在 React 树内（需要访问 useAgentActions 依赖的 store）。
 *
 * @module renderer/plugins/PluginHostBridge
 */

import { useEffect } from 'react'
import { useAgentCommands } from '@hooks/useAgent'
import { logger } from '@toolkit/LogEngine'
import { PLUGIN_CHAT_SEND_EVENT, type PluginChatSendDetail } from './PluginHostApi'

/** window 上标记 bridge 就绪的全局字段名 */
const READY_FLAG = '__AWEECLAW_PLUGIN_HOST_READY__'

/** 设备联动 AI 任务事件名（来自 authSlice 的 onAiTask/onRunScenario） */
const DEVICE_LINK_AI_TASK_EVENT = 'aweeclaw:device-link:ai-task'

export function PluginHostBridge() {
  const { sendMessage } = useAgentCommands()

  useEffect(() => {
    /** 处理插件发送聊天消息的请求 */
    const handleChatSend = async (event: Event) => {
      const detail = (event as CustomEvent<PluginChatSendDetail>).detail
      if (!detail?.text) return
      try {
        await sendMessage(detail.text)
      } catch (err) {
        logger.system.error(
          `[PluginHostBridge] sendMessage failed (plugin=${detail.pluginKey}):`,
          err,
        )
      }
    }

    /** 处理设备联动 AI 任务请求（来自移动端远程触发） */
    const handleDeviceLinkAiTask = async (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; scenarioId?: string }>).detail
      if (!detail?.text) return
      try {
        await sendMessage(detail.text)
        logger.system.info('[PluginHostBridge] Device-link AI task sent to agent')
      } catch (err) {
        logger.system.error('[PluginHostBridge] Device-link AI task failed:', err)
      }
    }

    window.addEventListener(PLUGIN_CHAT_SEND_EVENT, handleChatSend as EventListener)
    window.addEventListener(DEVICE_LINK_AI_TASK_EVENT, handleDeviceLinkAiTask as EventListener)
    // 标记 bridge 就绪，供 PluginHostApi 检测
    ;(window as unknown as Record<string, unknown>)[READY_FLAG] = true

    return () => {
      window.removeEventListener(PLUGIN_CHAT_SEND_EVENT, handleChatSend as EventListener)
      window.removeEventListener(DEVICE_LINK_AI_TASK_EVENT, handleDeviceLinkAiTask as EventListener)
      delete (window as unknown as Record<string, unknown>)[READY_FLAG]
    }
  }, [sendMessage])

  // 不渲染任何 UI，仅作为副作用容器
  return null
}
