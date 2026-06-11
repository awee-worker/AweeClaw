import { logger } from '@shared/toolkit/LogEngine'
import { channelRegistry } from './AdapterRegistry'
import { channelConfigStore } from './ChannelConfigRepository'
import { channelSecurityManager } from './MessageSecurityGuard'
import { channelErrorHandler } from './MessageErrorHandler'
import { webhookServer } from './WebhookReceiver'
import { channelPluginRegistrar } from './ChannelPluginRegistrar'
import { agentRouter } from '../agent/AgentRouter'
import { feishuChannelPlugin } from './adapters/feishu'
import { wechatChannelPlugin } from './adapters/wechat'
import { weixinChannelPlugin } from './adapters/weixin'
import { wechatmpChannelPlugin } from './adapters/wechatmp'
import { whatsappChannelPlugin } from './adapters/whatsapp'
import { qqChannelPlugin } from './adapters/qq'
import { dingtalkChannelPlugin } from './adapters/dingtalk'
import { slackChannelPlugin } from './adapters/slack'
import { discordChannelPlugin } from './adapters/discord'
import { telegramChannelPlugin } from './adapters/telegram'
import { misskeyChannelPlugin } from './adapters/misskey'
import { matrixChannelPlugin } from './adapters/matrix'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelConfig,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
} from '@shared/protocols/channel'

class ChannelService {
  private initialized = false
  private inboundHandlers: Array<(message: InboundMessage) => void> = []

  async init(): Promise<void> {
    if (this.initialized) return
    logger.channel.info('Initializing channel service...')
    channelConfigStore.load()
    this.registerBuiltInPlugins()
    channelRegistry.onMessage(msg => this.handleInboundMessage(msg))

    // 非阻塞启动：注册插件后立即返回，各渠道连接在后台异步进行
    // 避免网络超时（如飞书 ETIMEDOUT）阻塞应用启动
    channelRegistry.startFromConfig(channelConfigStore.getEnabledConfigs()).then(() => {
      logger.channel.info('All channel auto-connections completed')
    }).catch(err => {
      logger.channel.error(`[ChannelService] Auto-connect error: ${err instanceof Error ? err.message : String(err)}`)
    })

    const hasWebhookChannels = channelConfigStore.getEnabledConfigs().some(
      c => c.id === 'wechat' || c.id === 'whatsapp'
    )
    if (hasWebhookChannels) {
      try {
        await webhookServer.start()
      } catch (err) {
        logger.channel.error(`[ChannelService] Webhook server failed to start: ${err}`)
      }
    }
    this.initialized = true
    logger.channel.info('Channel service initialized (connections running in background)')
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return
    logger.channel.info('Shutting down channel service...')
    await webhookServer.stop()
    await channelRegistry.stopAll()
    channelErrorHandler.destroy()
    this.initialized = false
    logger.channel.info('Channel service shut down')
  }

  getRegisteredChannels(): Array<{ id: ChannelId; meta: ChannelPlugin['meta'] }> {
    return channelRegistry.getAllPlugins().map(p => ({ id: p.id, meta: p.meta }))
  }

  getWebhookInfo(): { running: boolean; port: number; url: string } {
    return {
      running: webhookServer.isRunning(),
      port: webhookServer.getPort(),
      url: webhookServer.getWebhookUrl(),
    }
  }

  getChannelSecretSchema(channelId: ChannelId) {
    const plugin = channelRegistry.getPlugin(channelId)
    return plugin?.secretSchema || []
  }

  async validateCredentials(channelId: ChannelId, credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const plugin = channelRegistry.getPlugin(channelId)
    if (!plugin) return { valid: false, error: 'Channel not found' }
    return plugin.validateCredentials(credentials)
  }

  async addAccount(channelId: ChannelId, account: ChannelAccountConfig): Promise<void> {
    const plugin = channelRegistry.getPlugin(channelId)
    if (!plugin) throw new Error(`Channel not found: ${channelId}`)
    if (channelId === 'feishu') {
      const feishuPlugin = channelPluginRegistrar.getChannelPlugin('feishu') as any
      feishuPlugin?.registerAccount?.(account)
    }
    let config = channelConfigStore.get(channelId)
    if (!config) {
      config = { id: channelId, enabled: true, accounts: [] }
    }
    config.accounts = config.accounts.filter(a => a.id !== account.id)
    config.accounts.push(account)
    channelConfigStore.set(config)
    if (account.enabled) {
      await channelRegistry.connectAccount(channelId, account)
    }
    if ((channelId === 'wechat' || channelId === 'whatsapp') && !webhookServer.isRunning()) {
      try {
        await webhookServer.start()
      } catch (err) {
        logger.channel.error(`[ChannelService] Webhook server failed to start: ${err}`)
      }
    }
    logger.channel.info(`Added account ${account.id} to channel ${channelId}`)
  }

  async removeAccount(channelId: ChannelId, accountId: string): Promise<void> {
    const config = channelConfigStore.get(channelId)
    if (!config) return
    config.accounts = config.accounts.filter(a => a.id !== accountId)
    channelConfigStore.set(config)
    try {
      await channelRegistry.disconnectAccount(channelId, accountId)
    } catch {
      // ignore
    }
    if (channelId === 'feishu') {
      const feishuPlugin = channelPluginRegistrar.getChannelPlugin('feishu') as any
      feishuPlugin?.unregisterAccount?.(accountId)
    }
    logger.channel.info(`Removed account ${accountId} from channel ${channelId}`)
  }

  async updateAccount(channelId: ChannelId, account: ChannelAccountConfig): Promise<void> {
    await this.removeAccount(channelId, account.id)
    await this.addAccount(channelId, account)
  }

  async connectAccount(channelId: ChannelId, accountId: string): Promise<void> {
    const config = channelConfigStore.get(channelId)
    if (!config) throw new Error(`Channel config not found: ${channelId}`)
    const account = config.accounts.find(a => a.id === accountId)
    if (!account) throw new Error(`Account not found: ${accountId}`)
    account.enabled = true
    channelConfigStore.set(config)
    await channelRegistry.connectAccount(channelId, account)
  }

  async disconnectAccount(channelId: ChannelId, accountId: string): Promise<void> {
    const config = channelConfigStore.get(channelId)
    if (!config) return
    const account = config.accounts.find(a => a.id === accountId)
    if (account) {
      account.enabled = false
      channelConfigStore.set(config)
    }
    await channelRegistry.disconnectAccount(channelId, accountId)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    const result = await channelRegistry.sendMessage(message)
    if (!result.success && channelErrorHandler.isRetryable(result.error || '', message.channelId)) {
      channelErrorHandler.scheduleRetry(message, result.error || 'unknown')
    }
    return result
  }

  getAccountStatus(channelId: ChannelId, accountId: string): ChannelAccountSnapshot | undefined {
    return channelRegistry.getAccountStatus(channelId, accountId)
  }

  getAllAccountStatuses(): ChannelAccountSnapshot[] {
    const snapshots = channelRegistry.getAllAccountStatuses()
    const seen = new Set(snapshots.map(s => s.accountId))

    // 补充配置中存在但尚未连接的账户（显示为 disconnected）
    for (const config of channelConfigStore.getAll()) {
      for (const account of config.accounts) {
        if (seen.has(account.id)) continue
        snapshots.push({
          accountId: account.id,
          name: account.name,
          enabled: account.enabled,
          configured: true,
          status: 'disconnected',
          connected: false,
          lastConnectedAt: null,
          lastError: null,
        })
        seen.add(account.id)
      }
    }

    return snapshots
  }

  getConfig(channelId: ChannelId): ChannelConfig | undefined {
    return channelConfigStore.get(channelId)
  }

  getAllConfigs(): ChannelConfig[] {
    return channelConfigStore.getAll()
  }

  setChannelEnabled(channelId: ChannelId, enabled: boolean): void {
    channelConfigStore.update(channelId, { enabled })
  }

  onInboundMessage(handler: (message: InboundMessage) => void): () => void {
    this.inboundHandlers.push(handler)
    return () => {
      const idx = this.inboundHandlers.indexOf(handler)
      if (idx >= 0) this.inboundHandlers.splice(idx, 1)
    }
  }

  /**
   * 注册内置渠道插件
   * 通过 ChannelPluginRegistrar 统一注册到 Plugin SDK 体系
   */
  private registerBuiltInPlugins(): void {
    const plugins = [
      feishuChannelPlugin,
      wechatChannelPlugin,
      weixinChannelPlugin,
      wechatmpChannelPlugin,
      whatsappChannelPlugin,
      qqChannelPlugin,
      dingtalkChannelPlugin,
      slackChannelPlugin,
      discordChannelPlugin,
      telegramChannelPlugin,
      misskeyChannelPlugin,
      matrixChannelPlugin,
    ]

    // 通过 ChannelPluginRegistrar 注册到 Plugin SDK
    channelPluginRegistrar.registerAll(plugins)

    // 同时注册到 ChannelRegistry（保持向后兼容）
    for (const plugin of plugins) {
      channelRegistry.register(plugin)
    }

    logger.channel.info('Registered built-in channel plugins via Plugin SDK: feishu, wechat, weixin, wechatmp, whatsapp, qq, dingtalk, slack, discord, telegram, misskey, matrix')
  }

  private handleInboundMessage(message: InboundMessage): void {
    const config = channelConfigStore.get(message.channelId)
    if (!config) {
      logger.channel.warn(`[ChannelService] Inbound message discarded: no config for channelId=${message.channelId}, accountId=${message.accountId}`)
      return
    }
    const account = config.accounts.find(a => a.id === message.accountId)
    if (!account) {
      logger.channel.warn(`[ChannelService] Inbound message discarded: no account ${message.accountId} in channelId=${message.channelId}, available accounts: [${config.accounts.map(a => a.id).join(', ')}]`)
      return
    }
    const validation = channelSecurityManager.validateInboundMessage(message, account)
    if (!validation.allowed) {
      logger.channel.warn(`Inbound message blocked: ${validation.reason}`)
      return
    }
    const policy = channelSecurityManager.getPolicy(`${message.channelId}:${message.accountId}`)
    const rateLimitResult = channelSecurityManager.checkRateLimit(
      `${message.channelId}:${message.from}`,
      policy.rateLimitPerMinute
    )
    if (!rateLimitResult.allowed) {
      logger.channel.warn(`Rate limit exceeded for ${message.from} on ${message.channelId}`)
      return
    }
    logger.channel.info(`[ChannelService] Dispatching inbound message to ${this.inboundHandlers.length} handler(s): channelId=${message.channelId}, from=${message.from}`)

    // 尝试通过 AgentRouter 路由到特定 Agent
    const routingResult = agentRouter.route(message)
    if (routingResult) {
      logger.channel.info(`[ChannelService] AgentRouter matched: agent=${routingResult.agentId}, reason=${routingResult.reason}`)
      // 将路由信息附加到消息上，供下游 handler 使用
      const enrichedMessage = Object.assign({}, message, {
        _routing: {
          agentId: routingResult.agentId,
          bindingId: routingResult.bindingId,
          reason: routingResult.reason,
          needsSpawn: routingResult.needsSpawn,
        },
      })
      for (const handler of this.inboundHandlers) {
        try {
          handler(enrichedMessage)
        } catch (err) {
          logger.channel.error(`Inbound handler error: ${err}`)
        }
      }
      return
    }

    // 无 Agent 路由匹配，按原有逻辑分发
    for (const handler of this.inboundHandlers) {
      try {
        handler(message)
      } catch (err) {
        logger.channel.error(`Inbound handler error: ${err}`)
      }
    }
  }
}

export const channelService = new ChannelService()
