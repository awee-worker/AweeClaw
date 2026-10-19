/**
 * 插件宿主 API 工厂
 *
 * 构造注入给插件 UI 组件的 PluginHostApi 对象。
 * 插件组件通过 props.host 调用此 API，访问 MCP 工具、配置等宿主能力。
 *
 * 安全设计：不直接暴露 window.electronAPI 给插件，
 * 仅通过白名单方法（callTool/getConfig）提供受限访问。
 *
 * @module renderer/plugins/PluginHostApi
 */

import type { PluginHostApi, PluginToolResult } from './types'

/**
 * 插件 → 宿主「发送聊天消息」事件的 CustomEvent 名称。
 *
 * 设计说明：
 * 插件 UI 不直接耦合客户端内部的 Agent / IntelligenceStore，而是通过 window
 * 上的 CustomEvent 解耦：PluginHostApi.sendChatMessage 派发此事件，由
 * PluginHostBridge（客户端内部组件，可访问 useAgentActions）监听并真正发送。
 */
export const PLUGIN_CHAT_SEND_EVENT = 'aweeclaw:plugin-chat-send'

/** 插件聊天消息事件的 detail 载荷 */
export interface PluginChatSendDetail {
  text: string
  pluginKey: string
}

/**
 * 插件 → 宿主「关闭插件抽屉」事件的 CustomEvent 名称。
 *
 * 同样是解耦：抽屉状态由 pluginDrawerStore 持有，插件不应直接 import 它。
 */
export const PLUGIN_CLOSE_DRAWER_EVENT = 'aweeclaw:plugin-close-drawer'

/**
 * 插件 → 宿主「记录操作结果到会话上下文」事件的 CustomEvent 名称。
 *
 * 与 sendChatMessage 的区别：只更新上下文，不发送消息、不触发 AI 回复。
 */
export const PLUGIN_CONTEXT_NOTE_EVENT = 'aweeclaw:plugin-context-note'

/** 操作结果说明事件的 detail 载荷 */
export interface PluginContextNoteDetail {
  /** 完整说明：写入会话上下文，供 AI 理解，可以写长 */
  text: string
  pluginKey: string
  /** 插件展示名（中文界面），用于插件上下文尚未挂载时补建时展示 */
  displayName?: string
  /**
   * 界面短标签（可选）
   *
    * 输入框上方展示的是「当前选中了什么」，一句话足够；
     * 不传时回退用 text，但长句会把标签撑开，能省则省。
     */
  label?: string
  /**
   * 二级项标识（如「生成方式」「风格」）
   *
   * 同一个技能/插件常同时有多个并列二级项，写回结果必须按标识归位：
   * 没有标识就会被当成整体替换，把用户先前在别的二级项里做的选择冲掉。
   * 插件不传时由宿主按 label 的前缀推导。
   */
  selectionKey?: string
}

/**
 * 创建插件宿主 API
 *
 * @param opts.pluginKey 插件唯一标识
 * @param opts.mcpServerId MCP 服务器 ID（可选，默认 plugin:<pluginKey>）
 * @param opts.language 当前界面语言
 * @returns PluginHostApi 实例
 */
export function createPluginHostApi(opts: {
  pluginKey: string
  mcpServerId?: string
  language: 'zh' | 'en'
}): PluginHostApi {
  const { pluginKey, language } = opts
  const serverId = opts.mcpServerId ?? `plugin:${pluginKey}`

  // 安全获取 electronAPI（防御性编程，避免渲染进程环境异常）
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined

  return {
    pluginKey,
    serverId,
    language,

    callTool: async (toolName, args) => {
      if (!electronAPI?.mcpCallTool) {
        return { success: false, error: 'MCP API not available in this environment' }
      }
      try {
        const result = await electronAPI.mcpCallTool({
          serverId,
          toolName,
          arguments: args,
        })
        // MCP callTool 返回结构可能是 { content, isError } 或 { success, content, error }
        // 统一适配为 PluginToolResult
        const r = result as unknown as {
          content?: PluginToolResult['content']
          isError?: boolean
          success?: boolean
          error?: string
        }
        const isError = r.isError === true
        return {
          success: r.success ?? !isError,
          content: r.content,
          error: isError ? r.error ?? 'Tool execution returned error' : r.error,
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errMsg }
      }
    },

    getConfig: () => {
      // pluginGetConfig 是 async，但宿主 API 约定为同步返回
      // 实际配置在安装时已缓存，这里做同步降级（返回空对象，插件应通过 callTool 获取运行时状态）
      // 如果未来需要同步配置，可在 PluginUiRegistry 中预加载并注入
      return {}
    },

    sendChatMessage: (text: string) => {
      // 通过 window CustomEvent 解耦：PluginHostBridge 监听并调用真正的 sendMessage。
      // 返回一个已 resolve 的 Promise（实际发送是异步的，由 bridge 处理）；
      // 若宿主未挂载 bridge，给出明确错误而非静默失败。
      return new Promise<void>((resolve, reject) => {
        if (typeof window === 'undefined') {
          reject(new Error('window unavailable'))
          return
        }
        try {
          window.dispatchEvent(
            new CustomEvent<PluginChatSendDetail>(PLUGIN_CHAT_SEND_EVENT, {
              detail: { text, pluginKey },
            }),
          )
          // 通过自定义标记位检测 bridge 是否就绪（dispatchEvent 对无监听器仍返回 true，不可靠）
          if (!(window as unknown as { __AWEECLAW_PLUGIN_HOST_READY__?: boolean }).__AWEECLAW_PLUGIN_HOST_READY__) {
            // 无 bridge 监听：仍 resolve，避免阻塞插件 UI；记日志提示
            console.warn(`[PluginHostApi] sendChatMessage: host bridge not ready (plugin=${pluginKey})`)
          }
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    },

    setContextNote: (text: string, label?: string, selectionKey?: string) => {
      if (!text) return
      // 与 sendChatMessage 同为事件解耦：真正写入会话上下文的是 PluginHostBridge，
      // 这里只负责把「结果说明」交给宿主，不触发任何 AI 调用。
      try {
        window.dispatchEvent(
          new CustomEvent<PluginContextNoteDetail>(PLUGIN_CONTEXT_NOTE_EVENT, {
            detail: { text, pluginKey, label, selectionKey },
          }),
        )
      } catch (err) {
        console.warn(`[PluginHostApi] setContextNote failed (plugin=${pluginKey}):`, err)
      }
    },

    closeDrawer: () => {
      try {
        window.dispatchEvent(
          new CustomEvent<{ pluginKey: string }>(PLUGIN_CLOSE_DRAWER_EVENT, {
            detail: { pluginKey },
          }),
        )
      } catch (err) {
        console.warn(`[PluginHostApi] closeDrawer failed (plugin=${pluginKey}):`, err)
      }
    },

    log: {
      info: (...args: unknown[]) => console.log(`[Plugin:${pluginKey}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${pluginKey}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${pluginKey}]`, ...args),
    },
  }
}
