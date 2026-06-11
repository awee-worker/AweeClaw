/**
 * Channel 插件注册器
 *
 * 将现有 Channel adapter 桥接到 Plugin SDK 体系。
 * 负责为每个内置 Channel adapter 生成 PluginManifest 并注册到 PluginRegistry。
 *
 * 设计原则：
 * - 现有 ChannelPlugin 接口不变，adapter 代码无需修改
 * - 通过适配层将 ChannelPlugin 包装为 PluginRuntime
 * - MessagingService 不再硬编码 import adapter，而是从 PluginRegistry 获取
 *
 * @module messaging/ChannelPluginRegistrar
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getPluginRegistry } from '../plugin-sdk/PluginRegistry'
import type { PluginManifest, PluginRuntime, PluginContext } from '@shared/plugin-sdk/types'
import type { ChannelPlugin, ChannelId } from '@shared/protocols/channel'

// ============================================
// Channel 插件 Manifest 生成
// ============================================

/** 从 ChannelPlugin 实例生成 PluginManifest */
function channelPluginToManifest(plugin: ChannelPlugin): PluginManifest {
  const channelId = plugin.id
  const meta = plugin.meta

  return {
    id: `channel-${channelId}`,
    name: meta.label,
    nameZh: meta.labelZh,
    description: meta.description,
    descriptionZh: meta.descriptionZh,
    type: 'channel',
    version: '1.0.0',
    main: `builtin://channel/${channelId}`,
    icon: meta.icon,
    lifecycle: 'singleton',
    builtin: true,
    capabilities: {
      channel: {
        connectionModes: meta.connectionModes,
        chatTypes: meta.capabilities.chatTypes,
        media: meta.capabilities.media,
        reactions: meta.capabilities.reactions,
        threads: meta.capabilities.threads,
        edit: meta.capabilities.edit,
        streaming: meta.capabilities.streaming,
        voice: meta.capabilities.voice,
        files: meta.capabilities.files,
      },
    },
    configSchema: {
      fields: plugin.secretSchema.map(s => ({
        key: s.key,
        label: s.label,
        labelZh: s.labelZh,
        description: s.description,
        descriptionZh: s.descriptionZh,
        type: s.secret ? 'password' : 'text',
        required: s.required,
        placeholder: s.placeholder,
        secret: s.secret,
      })),
    },
  }
}

// ============================================
// Channel 插件运行时适配器
// ============================================

/** 将 ChannelPlugin 适配为 PluginRuntime */
class ChannelPluginRuntimeAdapter implements PluginRuntime {
  private ctx: PluginContext | null = null

  constructor(private channelPlugin: ChannelPlugin, readonly manifest: PluginManifest) {}

  get channelId(): ChannelId {
    return this.channelPlugin.id
  }

  get underlying(): ChannelPlugin {
    return this.channelPlugin
  }

  async initialize(ctx: PluginContext): Promise<void> {
    this.ctx = ctx
    ctx.logger.info(`Channel plugin initialized: ${this.channelPlugin.id}`)
  }

  async destroy(): Promise<void> {
    try {
      this.channelPlugin.destroy()
    } catch (err) {
      this.ctx?.logger.warn(`Error destroying channel plugin: ${err}`)
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string; details?: Record<string, unknown> }> {
    return { healthy: true, message: 'Channel plugin is active' }
  }
}

// ============================================
// Channel 插件注册器
// ============================================

class ChannelPluginRegistrar {
  /** 已注册的 Channel 插件映射（channelId → ChannelPluginRuntimeAdapter） */
  private adapters = new Map<ChannelId, ChannelPluginRuntimeAdapter>()

  /**
   * 注册内置 Channel 插件到 Plugin Registry
   * @param plugin ChannelPlugin 实例
   */
  register(plugin: ChannelPlugin): void {
    const channelId = plugin.id
    const manifest = channelPluginToManifest(plugin)
    const adapter = new ChannelPluginRuntimeAdapter(plugin, manifest)

    this.adapters.set(channelId, adapter)

    // 注册到 Plugin Registry（传入工厂函数）
    const registry = getPluginRegistry()
    registry.registerBuiltin(manifest, (_ctx) => {
      // 工厂函数返回一个新的适配器实例
      return new ChannelPluginRuntimeAdapter(plugin, manifest)
    })

    logger.channel.info(`[ChannelPluginRegistrar] Registered channel plugin: ${channelId}`)
  }

  /**
   * 批量注册内置 Channel 插件
   */
  registerAll(plugins: ChannelPlugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin)
    }
    logger.channel.info(`[ChannelPluginRegistrar] Registered ${plugins.length} channel plugins`)
  }

  /**
   * 获取 ChannelPlugin 实例
   */
  getChannelPlugin(channelId: ChannelId): ChannelPlugin | undefined {
    return this.adapters.get(channelId)?.underlying
  }

  /**
   * 获取所有已注册的 ChannelPlugin 实例
   */
  getAllChannelPlugins(): ChannelPlugin[] {
    return Array.from(this.adapters.values()).map(a => a.underlying)
  }

  /**
   * 获取所有已注册的 Channel ID
   */
  getRegisteredChannelIds(): ChannelId[] {
    return Array.from(this.adapters.keys())
  }
}

/** 全局 Channel 插件注册器实例 */
export const channelPluginRegistrar = new ChannelPluginRegistrar()
