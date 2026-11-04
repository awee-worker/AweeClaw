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

import { useStore } from '@store'
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
/** 插件聊天消息事件的 detail 载荷 */
export interface PluginChatSendDetail {
  text: string
  pluginKey: string
  /**
   * 场景内工作单元标识（可选）
   *
   * 插件把「这次运行属于哪个工作单元」交代清楚（如原型工坊的项目 ID），宿主会为
   * 每个 key 维护一条独立的场景工作线程。这类线程不切换主聊天线程、也不进会话
   * 列表 —— 场景里的 AI 产出属于画布 / 报表本身，不该混进用户的对话历史。
   *
   * 不传时退化为按插件维度隔离（同一插件共用一个工作线程）。
   */
  scenarioKey?: string
  /**
   * 本次运行指定的模型（可选）
   *
   * 不传就跟着客户端当前的模型设置跑。插件面板里让用户选模型是有意义的：
   * 同一段需求，弱模型只画出骨架、强模型能一次给到可用版面，用户不该为此
   * 跑去设置页改全局配置（改完还得改回来）。
   */
  model?: PluginChatModelRef
}

/** 模型定位：服务商 + 模型 ID */
export interface PluginChatModelRef {
  provider: string
  model: string
}

/**
 * 插件 → 宿主「AI 运行状态」事件的 CustomEvent 名称。
 *
 * 插件把需求交给会话后，往往只需要「还在生成 / 已经完成」这一层反馈，
 * 并不想把人机对话的完整输出搬进自己的面板（插件面板小，长文会挤爆布局）。
 * 宿主因此把一次由插件发起的运行压缩成几个阶段事件，插件按需订阅。
 */
export const PLUGIN_CHAT_STATE_EVENT = 'aweeclaw:plugin-chat-state'

/** 运行阶段：排队执行中 / 已结束 / 出错 */
export type PluginChatPhase = 'running' | 'done' | 'error'

/** AI 运行状态事件的 detail 载荷 */
export interface PluginChatStateDetail {
  /** 发起这次运行的插件 */
  pluginKey: string
  phase: PluginChatPhase
  /** 当前正在执行的工具名（如 proto_generate_page），插件可据此显示具体步骤 */
  tool?: string
  /** 宿主给出的阶段文案 */
  statusText?: string
  /**
   * 结束时助手回复的摘要
   *
   * 上限 1200 字：之前截到 200 字，长回复（一份镜头脚本、一段方案说明）里
   * 「是否在等用户确认」的判断依据往往落在结尾，被截掉之后插件只能猜，
   * 于是把「等你点头」误报成「什么都没做」。
   */
  summary?: string
  error?: string
  /**
   * 本轮调用过的工具名（含成功与失败，按调用顺序）
   *
   * 插件据此判断过程停在哪一步：调过脚本工具却没成功生成镜头，说明卡在
   * 「脚本待确认」，可以就地给一个确认入口，而不是让用户把脚本复制回输入框。
   */
  calledTools?: string[]
  /**
   * 本轮失败的工具调用
   *
   * 模型未必会把失败说在回复里：工具被权限拦下、插件没装，它可能照样回一句
   * 「已按脚本开始生成」。插件只靠摘要判断就会把这类失败误报成「在等你确认」，
   * 用户永远看不到真正的原因。宿主把失败的工具名与错误原文一并带出来。
   */
  failedTools?: Array<{ name: string; error: string }>
}

/**
 * 宿主 → 插件「AI 正在等用户做选择」事件的 CustomEvent 名称
 *
 * 场景工作线程的对话不在聊天面板里，ask_user 产生的选项卡片也就没有渲染位置。
 * 宿主把待选内容转成事件抛给插件面板，由面板自己在身边渲染 —— 用户在哪工作，
 * 选项就出现在哪，不必为了点一个按钮切回聊天窗口。
 */
export const PLUGIN_CHAT_INTERACTIVE_EVENT = 'aweeclaw:plugin-chat-interactive'

/** 待选内容：与工具执行器给到的 interactive 结构一致 */
export interface PluginChatInteractiveDetail {
  pluginKey: string
  /** 承载这次提问的助手消息 ID，回答时原样带回 */
  messageId: string
  question: string
  options: Array<{ id: string; label: string; description?: string }>
  multiSelect?: boolean
  /** 是否允许自定义回答（对应 ask_user 的 allow_other） */
  allowCustom?: boolean
}

/**
 * 插件 → 宿主「用户已完成选择」事件的 CustomEvent 名称
 *
 * 宿主据此把选择写回消息并静默续发给模型，链路与聊天面板里的选项卡片一致。
 */
export const PLUGIN_CHAT_ANSWER_EVENT = 'aweeclaw:plugin-chat-answer'

export interface PluginChatAnswerDetail {
  pluginKey: string
  messageId: string
  /** 选中的选项 ID */
  selectedIds: string[]
  /** 「其他」自由输入内容 */
  customText?: string
}

/** 插件 → 宿主「中止本次运行」事件的 CustomEvent 名称 */
export const PLUGIN_CHAT_ABORT_EVENT = 'aweeclaw:plugin-chat-abort'

export interface PluginChatAbortDetail {
  pluginKey: string
}

/**
 * 宿主 → 插件「当前可用模型清单」事件的 CustomEvent 名称
 *
 * 哪些模型能用取决于用户启用了哪些服务商、填了哪些凭证，只有宿主读得到完整
 * 配置。插件面板需要模型下拉时不要自己猜，等这份清单。
 */
export const PLUGIN_MODELS_EVENT = 'aweeclaw:plugin-models'

/**
 * 插件 → 宿主「请把可用模型清单发我」事件的 CustomEvent 名称
 *
 * 宿主的首次广播可能早于插件挂载，只靠被动监听会永远拿到空清单；
 * 插件挂载后补发一次请求，宿主据此再广播一遍。
 */
export const PLUGIN_MODELS_REQUEST_EVENT = 'aweeclaw:plugin-models-request'

export interface PluginModelsRequestDetail {
  pluginKey?: string
}

/** 可用模型条目：与聊天输入框模型选择器同源 */
export interface PluginModelOption {
  providerId: string
  id: string
  name: string
  providerName: string
  /**
   * 能力标签（llm / image-gen / video-gen / audio ...）
   *
   * 插件需要按能力筛模型时（例如视频生成只能选标注了 video-gen 的模型），
   * 用这个字段判断，不要靠模型名猜 —— 用户可以在服务商设置里手工改标签。
   */
  capabilities?: string[]
}

/** 可用模型清单事件的 detail 载荷 */
export interface PluginModelsDetail {
  models: PluginModelOption[]
  /** 客户端当前正在用的模型，插件可以据此标注「默认」 */
  current?: PluginChatModelRef
}

/**
 * 插件 → 宿主「关闭插件抽屉」事件的 CustomEvent 名称。
 *
 * 同样是解耦：抽屉状态由 pluginDrawerStore 持有，插件不应直接 import 它。
 */
export const PLUGIN_CLOSE_DRAWER_EVENT = 'aweeclaw:plugin-close-drawer'

/**
 * 插件 → 宿主「关闭插件侧边栏面板」事件的 CustomEvent 名称。
 *
 * 与 closeDrawer 的区别：抽屉是盖在界面上的浮层，侧边栏面板是常驻的导航项。
 * 后者由 layoutSlice 的 activeSidePanel 持有，插件不该直接 import store，
 * 同样走事件解耦，由 PluginHostBridge 转译成 setActiveSidePanel(null)。
 */
export const PLUGIN_CLOSE_PANEL_EVENT = 'aweeclaw:plugin-close-panel'

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

    openInternalBrowser: (options) => {
      const url = typeof options?.url === 'string' ? options.url.trim() : ''
      if (!url) throw new Error('openInternalBrowser 需要 url')
      // 只切布局、不涉及插件业务数据，直接走 store 即可；
      // 与 sendChatMessage 不同，这里没有需要跨组件协作的异步链路。
      useStore.getState().openInternalBrowser(url, options.title, undefined, options.partition)
    },

    reloadInternalBrowser: () => {
      // 与 openInternalBrowser 一样只动布局状态，不需要走事件桥
      useStore.getState().reloadInternalBrowser()
    },

    getConfig: () => {
      // pluginGetConfig 是 async，但宿主 API 约定为同步返回
      // 实际配置在安装时已缓存，这里做同步降级（返回空对象，插件应通过 callTool 获取运行时状态）
      // 如果未来需要同步配置，可在 PluginUiRegistry 中预加载并注入
      return {}
    },

    sendChatMessage: (
      text: string,
      scenarioKey?: string,
      model?: PluginChatModelRef,
    ) => {
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
              detail: {
                text,
                pluginKey,
                ...(scenarioKey ? { scenarioKey } : {}),
                ...(model ? { model } : {}),
              },
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

    /**
     * 关闭承载本插件的侧边栏面板。
     *
     * 与 closeDrawer 分开实现：抽屉是浮层（pluginDrawerStore），面板是导航项
     * （layoutSlice.activeSidePanel），两者状态不同源，不能共用一个事件。
     * 插件面板据此在自己的头部放关闭按钮。
     */
    closePanel: () => {
      try {
        window.dispatchEvent(
          new CustomEvent<{ pluginKey: string }>(PLUGIN_CLOSE_PANEL_EVENT, {
            detail: { pluginKey },
          }),
        )
      } catch (err) {
        console.warn(`[PluginHostApi] closePanel failed (plugin=${pluginKey}):`, err)
      }
    },

    log: {
      info: (...args: unknown[]) => console.log(`[Plugin:${pluginKey}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${pluginKey}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${pluginKey}]`, ...args),
    },
  }
}
