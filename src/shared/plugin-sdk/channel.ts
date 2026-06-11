/**
 * Plugin SDK - Channel 插件扩展接口
 *
 * 在现有 ChannelPlugin 接口基础上，增加插件化注册能力。
 * Channel 插件通过 manifest 声明能力，运行时实现 ChannelPlugin 接口。
 *
 * @module plugin-sdk/channel
 */

import type {
  ChannelPlugin,
  ChannelId,
  ChannelMeta,
  ChannelSecretSchema,
} from '@shared/protocols/channel'
import type { PluginManifest, PluginRuntime, PluginContext } from './types'

// ============================================
// Channel 插件 Manifest 扩展
// ============================================

/** Channel 插件 Manifest - 在基础 Manifest 上扩展渠道特有字段 */
export interface ChannelPluginManifest extends PluginManifest {
  type: 'channel'
  /** 渠道 ID（如 'feishu', 'wechat' 等） */
  channelId: ChannelId
  /** 渠道元数据 */
  channelMeta: ChannelMeta
  /** 凭证 Schema（用于 UI 渲染配置表单） */
  secretSchema: ChannelSecretSchema[]
  /** 设置向导（可选，用于引导式配置） */
  setupWizard?: ChannelSetupWizard
}

/** 渠道设置向导 */
export interface ChannelSetupWizard {
  /** 向导步骤 */
  steps: ChannelSetupStep[]
  /** 完成后的验证回调 */
  validate?: (credentials: Record<string, string>) => Promise<{ valid: boolean; error?: string }>
}

export interface ChannelSetupStep {
  /** 步骤标题 */
  title: string
  /** 步骤中文标题 */
  titleZh: string
  /** 步骤描述 */
  description: string
  /** 步骤中文描述 */
  descriptionZh: string
  /** 步骤类型 */
  type: 'info' | 'input' | 'oauth' | 'qrcode'
  /** 输入字段（type=input 时） */
  fields?: Array<{
    key: string
    label: string
    labelZh: string
    type: 'text' | 'password' | 'url'
    required: boolean
    placeholder?: string
  }>
  /** OAuth 配置（type=oauth 时） */
  oauth?: {
    authorizeUrl: string
    tokenUrl: string
    scope?: string
  }
}

// ============================================
// Channel 插件运行时接口
// ============================================

/** Channel 插件运行时 - 组合 PluginRuntime 和 ChannelPlugin 能力 */
export interface ChannelPluginRuntime extends Omit<PluginRuntime, 'destroy'>, ChannelPlugin {
  /** 渠道 ID */
  readonly channelId: ChannelId
  /** 渠道 Manifest */
  readonly manifest: ChannelPluginManifest
  /** 插件销毁（覆盖 ChannelPlugin.destroy 和 PluginRuntime.destroy） */
  destroy(): Promise<void>
}

// ============================================
// Channel 插件绑定（Agent 路由）
// ============================================

/** 渠道绑定 - 将渠道账号路由到指定 Agent */
export interface ChannelBinding {
  /** 绑定 ID */
  id: string
  /** 渠道 ID */
  channelId: ChannelId
  /** 账号 ID */
  accountId: string
  /** 目标 Agent ID */
  agentId: string
  /** 绑定范围 */
  scope: ChannelBindingScope
  /** 是否启用 */
  enabled: boolean
}

/** 绑定范围 */
export type ChannelBindingScope =
  | 'all'                // 所有消息
  | 'dm-only'           // 仅私聊
  | 'group-only'        // 仅群聊
  | 'mention-only'      // 仅 @提及
  | 'custom'            // 自定义规则

/** 绑定解析结果 */
export interface BindingResolution {
  /** 匹配的绑定 */
  binding: ChannelBinding
  /** 目标 Agent ID */
  agentId: string
  /** 是否需要隔离 session */
  isolatedSession: boolean
}

// ============================================
// Channel 插件工厂
// ============================================

/** Channel 插件工厂 - 用于创建插件实例 */
export interface ChannelPluginFactory {
  /** 创建 Channel 插件实例 */
  create(context: PluginContext): ChannelPluginRuntime
  /** 获取 Manifest（无需创建实例） */
  getManifest(): ChannelPluginManifest
}
