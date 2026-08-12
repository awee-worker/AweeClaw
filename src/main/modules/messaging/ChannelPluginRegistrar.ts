/**
 * Channel 插件注册器
 *
 * 将现有 Channel adapter 桥接到 Plugin SDK 体系。
 * 负责为每个内置 Channel adapter 生成 PluginManifest 并注册到 PluginRegistry。
 * 同时支持外部渠道插件（通过插件市场安装）的动态注册。
 *
 * 设计原则：
 * - 现有 ChannelPlugin 接口不变，adapter 代码无需修改
 * - 通过适配层将 ChannelPlugin 包装为 PluginRuntime
 * - MessagingService 不再硬编码 import adapter，而是从 PluginRegistry 获取
 * - 外部渠道插件通过 PluginRegistry.loadExternalRuntime 加载后，由 handler 适配
 *
 * @module messaging/ChannelPluginRegistrar
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getPluginRegistry } from '../plugin-sdk/PluginRegistry'
import { channelRegistry } from './AdapterRegistry'
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
   * 注册外部渠道插件（通过插件市场安装）
   *
   * 与 register() 的区别：
   * - 不调用 registry.registerBuiltin()（外部插件已由 PluginRegistry.discover() 发现）
   * - manifest 来自插件的 manifest.json（而非从 ChannelPlugin 生成）
   * - 仅注册到 adapters Map，使渠道对 MessagingService 可见
   *
   * @param plugin 从外部模块导入的 ChannelPlugin 实例
   * @param manifest 插件的 manifest.json
   * @returns ChannelPluginRuntimeAdapter 实例
   */
  registerExternal(plugin: ChannelPlugin, manifest: PluginManifest): ChannelPluginRuntimeAdapter {
    const channelId = plugin.id
    const adapter = new ChannelPluginRuntimeAdapter(plugin, manifest)
    this.adapters.set(channelId, adapter)
    logger.channel.info(`[ChannelPluginRegistrar] Registered external channel plugin: ${channelId}`)
    return adapter
  }

  /**
   * 向 PluginRegistry 注册 Channel 插件加载处理器
   *
   * 当 PluginRegistry 加载 type='channel' 的外部插件时，会调用此处理器：
   * 1. 从 module 中提取 ChannelPlugin 实例
   * 2. 注册到 channelRegistry（消息收发就绪）
   * 3. 通过 registerExternal() 注册到 adapters Map（Plugin SDK 集成）
   * 4. 返回 ChannelPluginRuntimeAdapter 作为 PluginRuntime
   *
   * 应在应用启动时（MessagingService.init）调用，先于 registerBuiltInPlugins。
   */
  registerHandler(): void {
    const registry = getPluginRegistry()
    registry.registerChannelPluginHandler((manifest, module) => {
      // 外部渠道插件的入口模块应 default 导出 ChannelPlugin 实例
      const channelPlugin = (module.default ?? module) as ChannelPlugin

      if (!channelPlugin.id || !channelPlugin.meta || !channelPlugin.connect) {
        throw new Error(
          `Invalid channel plugin module: expected a ChannelPlugin instance as default export, ` +
          `got ${typeof channelPlugin} (keys: ${Object.keys(channelPlugin).join(', ')})`,
        )
      }

      // 注册到 channelRegistry（消息路由、账户管理、状态回调）
      channelRegistry.register(channelPlugin)

      // 注册到 channelPluginRegistrar（Plugin SDK 集成）
      const adapter = this.registerExternal(channelPlugin, manifest)
      return adapter
    })
    logger.channel.info('[ChannelPluginRegistrar] Channel plugin handler registered to PluginRegistry')
  }

  /**
   * 注销渠道插件（卸载时调用）
   */
  unregister(channelId: ChannelId): void {
    this.adapters.delete(channelId)
    logger.channel.info(`[ChannelPluginRegistrar] Unregistered channel plugin: ${channelId}`)
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
