/**
 * 插件 UI 扩展点 — 渲染进程类型定义
 *
 * @module renderer/plugins/types
 */

import type { ComponentType } from 'react'
import type { PluginSidebarPanelContribution, PluginTopActionContribution, PluginSettingsTabContribution, PluginWidgetCardContribution } from '@shared/plugin-sdk/types'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'

/**
 * 插件 UI 模块的默认导出形状
 *
 * 插件 ui.js 必须 default export 此形状的对象。
 * components / topActions / settingsTabs 的键名与 manifest.contributes 中的 component 字段对应。
 */
export interface PluginUiModule {
  /** 侧边栏面板组件映射：contributes.sidebarPanels[].component → React 组件 */
  components?: Record<string, ComponentType<PluginPanelProps>>
  /** 顶部按钮组件映射：contributes.topActions[].component → React 组件 */
  topActions?: Record<string, ComponentType<PluginPanelProps>>
  /** 设置页 Tab 组件映射：contributes.settingsTabs[].component → React 组件 */
  settingsTabs?: Record<string, ComponentType<PluginPanelProps>>
  /**
   * 工作台卡片预览组件映射：contributes.widgetCards[].previewComponent → React 组件
   * 组件签名：({ host, data, loading, onRefresh }: WidgetCardPreviewProps) => ReactNode
   */
  widgetCards?: Record<string, ComponentType<WidgetCardPreviewProps>>
  /**
   * 配置表单 action handler 映射：configSchema.fields[].action.kind → handler
   *
   * 插件可注册自定义 action handler，供 PluginConfigForm 在用户点击 action 按钮时调用。
   * handler 接收当前表单值和参数，返回结果列表或错误。
   */
  configActions?: Record<string, PluginConfigActionHandler>
}

/**
 * 配置表单 action handler 类型
 *
 * @param params 从 manifest.action.params 解析后的参数（{fieldKey} 已替换为表单值）
 * @param formValues 当前表单所有字段的值
 * @param host 插件宿主 API（调用 MCP 工具等）
 * @returns 结果列表（如模型列表）或错误
 */
export type PluginConfigActionHandler = (
  params: Record<string, string>,
  formValues: Record<string, string>,
  host: PluginHostApi,
) => Promise<PluginConfigActionResult>

/** action handler 返回结果 */
export interface PluginConfigActionResult {
  success: boolean
  /** 结果列表（如模型列表），用于弹出选择弹窗 */
  items?: string[]
  /** 直接填入 targetField 的值（跳过选择弹窗） */
  value?: string
  /** 错误信息 */
  error?: string
}

/**
 * 注入给插件 UI 组件的宿主 API
 *
 * 插件组件通过 props.host 访问此对象，调用插件自身的 MCP 工具、读取配置等。
 * 不直接暴露 window.electronAPI，保持安全边界。
 */
export interface PluginHostApi {
  /** 插件 pluginKey */
  pluginKey: string
  /** MCP serverId，固定为 plugin:<pluginKey> */
  serverId: string
  /**
   * 调用本插件的 MCP 工具（不经过 AI）
   * 等价于 mcpCallTool({serverId, toolName, arguments})
   */
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<PluginToolResult>
  /** 读取插件用户配置 */
  getConfig: () => Record<string, string>
  /**
   * 把一条请求交给 AI 处理。
   *
   * 用于插件 UI 将任务交接给 AI（例如录制结束后请求 AI 分析帧并保存宏）。
   * @param text 用户消息文本
   * @param scenarioKey 场景内工作单元标识（如当前项目 ID）
   * @param model 本次运行使用的模型（provider + model）。不传则用客户端当前设置
   *
   * 传了 scenarioKey 时消息进入该工作单元的**场景工作线程**：不切换主聊天线程、
   * 不进会话列表，对话内容也不会出现在聊天面板里 —— 场景里的 AI 产出属于画布 /
   * 报表本身，不应混进用户的对话历史。运行状态、需要用户选择的问题分别通过
   * `aweeclaw:plugin-chat-state` 与 `aweeclaw:plugin-chat-interactive` 事件回传，
   * 由插件面板就地展示。可用模型清单由 `aweeclaw:plugin-models` 广播。
   *
   * 不传时退化为原有行为：消息进入当前激活的会话线程。
   */
  sendChatMessage: (
    text: string,
    scenarioKey?: string,
    model?: { provider: string; model: string },
  ) => Promise<void>
  /**
   * 把一次操作的结果告知 AI，但不触发新的一轮对话。
   *
   * 结果记在当前会话里该插件的上下文项上，之后每条消息都会带上这段状态说明，
   * 因此 AI 知道「用户已经选了哪套模板」这类事实，而不必重新询问。
   * 插件上下文尚未挂载时会自动挂上。
   * @param text 结果说明，如「当前默认模板：科技深色（tech-dark）」
   * @param label 输入框上方的短标签，如「风格 · 科技深色」
   * @param selectionKey 二级项标识（如「风格」）。同一标识重复写回只覆盖自己，
   *        不传时由宿主按标签前缀推导，多个并列选择才能同时留在上下文里。
   */
  setContextNote: (text: string, label?: string, selectionKey?: string) => void
  /**
   * 关闭当前插件抽屉。
   *
   * 用于「选完即完成」的操作（如点选一个模板），省掉用户再点一次关闭。
   * 宿主未提供该方法时（旧版本客户端）插件应做存在性判断。
   */
  closeDrawer: () => void
  /**
   * 关闭承载本插件的侧边栏面板（导航项），回到对话 / 主视图。
   *
   * 与 closeDrawer 的区别：抽屉是浮层，面板是常驻导航项。面板自身带关闭按钮时
   * 用它收起自己。宿主未提供该方法时（旧版本客户端）插件应做存在性判断。
   */
  closePanel?: () => void
  /**
   * 在内置浏览器中打开一个页面。
   *
   * 托管类插件用它实现「进入管理」：站点由插件维护，用户点一下即可带着登录态
   * 进入该系统的页面，AI 之后可以直接用内置浏览器自动化继续操作。
   *
   * partition 与插件后台采集窗口保持一致，两边共享登录态；省略时沿用主窗口
   * 默认 session。宿主未提供该方法时（旧版本客户端）插件应做存在性判断。
   *
   * site 用来告诉宿主「这是哪个托管站点」：带上之后，用户在浏览器里直接对话时
   * AI 已经知道自己在服务哪个系统、当前停在哪一页，插件无需再单独写上下文。
   */
  openInternalBrowser?: (options: {
    url: string
    title?: string
    partition?: string
    /** 托管站点信息；普通网页不传 */
    site?: {
      id: string
      name: string
      category?: string
      origin?: string
      entryUrl?: string
    }
  }) => void
  /**
   * 刷新内置浏览器的当前页面。
   *
   * 插件在自己的站点分区里完成登录后，cookie 已落盘但页面不会自己更新，需要
   * 重载一次用户才能看到登录后的界面。内置浏览器未打开时是空操作。
   * 宿主未提供该方法时（旧版本客户端）插件应做存在性判断。
   */
  reloadInternalBrowser?: () => void
  /** 当前界面语言 */
  language: 'zh' | 'en'
  /** 受控日志（前缀 [Plugin:pluginKey]） */
  log: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

/** callTool 返回结果（与 MCP 工具响应一致） */
export interface PluginToolResult {
  success: boolean
  /** MCP 工具返回的内容块数组 */
  content?: Array<{
    type: string
    text?: string
    data?: string
    mimeType?: string
  }>
  /** 错误信息 */
  error?: string
}

/** 所有插件 UI 组件统一接收的 props */
export interface PluginPanelProps {
  host: PluginHostApi
}

/**
 * 工作台卡片预览组件 props
 *
 * 由 WorkbenchHome.PluginCardPreview 注入，组件通过此接口访问宿主能力与数据。
 */
export interface WidgetCardPreviewProps {
  /** 插件宿主 API（调用 MCP 工具等） */
  host: PluginHostApi
  /** 卡片数据（由刷新逻辑填充，首次为 null） */
  data: Record<string, unknown> | null
  /** 是否正在加载 */
  loading: boolean
  /** 触发手动刷新（用户点击刷新按钮时调用） */
  onRefresh: () => void
}

/**
 * 已加载的插件 UI 信息（PluginUiRegistry 内部使用）
 */
export interface LoadedPluginUi {
  pluginKey: string
  /** 从 ui.js 加载的模块 */
  module: PluginUiModule
  /** 该插件贡献的侧边栏面板（已转换为 SidebarItemDescriptor） */
  sidebarItems: SidebarItemDescriptor[]
  /** 该插件贡献的顶部按钮声明 */
  topActions: Array<{
    contribution: PluginTopActionContribution
    component: ComponentType<PluginPanelProps>
  }>
  /** 该插件贡献的设置页 Tab（已加载组件） */
  settingsTabs?: Array<{
    contribution: PluginSettingsTabContribution
    component: ComponentType<PluginPanelProps>
    host: PluginHostApi
  }>
  /** 该插件贡献的工作台卡片预览组件（已加载） */
  widgetCards?: Array<{
    contribution: PluginWidgetCardContribution
    component: ComponentType<WidgetCardPreviewProps>
  }>
}

/**
 * 将插件的 PluginSidebarPanelContribution 转换为客户端 SidebarItemDescriptor
 *
 * 复用现有场景系统的导航项类型，使插件面板与内置面板同构。
 */
export function contributionToSidebarItem(
  contribution: PluginSidebarPanelContribution,
): SidebarItemDescriptor {
  return {
    id: contribution.id,
    icon: contribution.icon,
    label: contribution.label,
    labelZh: contribution.labelZh,
    component: contribution.component,
    position: contribution.position ?? 50,
    wideMode: contribution.wideMode,
  }
}
