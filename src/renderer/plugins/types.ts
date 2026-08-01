/**
 * 插件 UI 扩展点 — 渲染进程类型定义
 *
 * @module renderer/plugins/types
 */

import type { ComponentType } from 'react'
import type { PluginSidebarPanelContribution, PluginTopActionContribution } from '@shared/plugin-sdk/types'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'

/**
 * 插件 UI 模块的默认导出形状
 *
 * 插件 ui.js 必须 default export 此形状的对象。
 * components / topActions 的键名与 manifest.contributes 中的 component 字段对应。
 */
export interface PluginUiModule {
  /** 侧边栏面板组件映射：contributes.sidebarPanels[].component → React 组件 */
  components?: Record<string, ComponentType<PluginPanelProps>>
  /** 顶部按钮组件映射：contributes.topActions[].component → React 组件 */
  topActions?: Record<string, ComponentType<PluginPanelProps>>
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
   * 向当前会话发送一条用户消息并触发 AI 处理。
   *
   * 用于插件 UI 将任务交接给 AI（例如录制结束后请求 AI 分析帧并保存宏）。
   * 消息会进入当前激活的会话线程，走与用户手动输入相同的链路。
   * @param text 用户消息文本
   */
  sendChatMessage: (text: string) => Promise<void>
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
