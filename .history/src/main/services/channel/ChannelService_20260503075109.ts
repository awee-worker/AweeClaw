import { logger } from '@shared/utils/Logger'
import { channelRegistry } from './ChannelRegistry'
import { channelConfigStore } from './ChannelConfigStore'
import { channelSecurityManager } from './ChannelSecurityManager'
import { channelErrorHandler } from './ChannelErrorHandler'
import { webhookServer } from './WebhookServer'
import { feishuChannelPlugin } from './adapters/FeishuChannelPlugin'
import { wechatChannelPlugin } from './adapters/WechatChannelPlugin'
import { whatsappChannelPlugin } from './adapters/WhatsAppChannelPlugin'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelConfig,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
} from '@shared/types/channel'

class ChannelService {
  private initialized = false
  private inboundHandlers: Array<(message: InboundMessage) => void> = []

  async init(): Promise<void> {
    if (this.initialized) return
    logger.channel.info('Initializing channel service...')
    channelConfigStore.load()
    this.registerBuiltInPlugins()
    channelRegistry.onMessage(msg => this.handleInboundMessage(msg))
    await channelRegistry.startFromConfig(channelConfigStore.getEnabledConfigs())
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
    logger.channel.info('Channel service initialized')
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
    if (channelId === 'feishu') feishuChannelPlugin.registerAccount(account)
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
    if (channelId === 'feishu') feishuChannelPlugin.unregisterAccount(accountId)
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
    return channelRegistry.getAllAccountStatuses()
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

  private registerBuiltInPlugins(): void {
    channelRegistry.register(feishuChannelPlugin)
    channelRegistry.register(wechatChannelPlugin)
    channelRegistry.register(whatsappChannelPlugin)
    logger.channel.info('Registered built-in channel plugins: feishu, wechat, whatsapp')
  }

  private handleInboundMessage(message: InboundMessage): void {
    const config = channelConfigStore.get(message.channelId)
    if (!config) return
    const account = config.accounts.find(a => a.id === message.accountId)
    if (!account) return
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
