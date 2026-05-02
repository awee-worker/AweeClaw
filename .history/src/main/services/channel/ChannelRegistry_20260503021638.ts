import { logger } from '@shared/utils/Logger'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelConfig,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
  ChannelEvent,
} from '@shared/types/channel'

type MessageCallback = (message: InboundMessage) => void
type StatusCallback = (snapshot: ChannelAccountSnapshot) => void
type EventCallback = (event: ChannelEvent) => void

class ChannelRegistry {
  private plugins = new Map<ChannelId, ChannelPlugin>()
  private accountStatuses = new Map<string, ChannelAccountSnapshot>()
  private messageCallbacks: MessageCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private eventCallbacks: EventCallback[] = []

  register(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`[ChannelRegistry] Plugin ${plugin.id} already registered, replacing`)
    }
    this.plugins.set(plugin.id, plugin)
    plugin.onMessage(msg => this.handleInboundMessage(msg))
    plugin.onStatusChange(snapshot => this.handleStatusChange(snapshot))
    plugin.onEvent(event => this.handleEvent(event))
    logger.info(`[ChannelRegistry] Registered channel plugin: ${plugin.id}`)
  }

  unregister(channelId: ChannelId): void {
    const plugin = this.plugins.get(channelId)
    if (plugin) {
      plugin.destroy()
      this.plugins.delete(channelId)
      logger.info(`[ChannelRegistry] Unregistered channel plugin: ${channelId}`)
    }
  }

  getPlugin(channelId: ChannelId): ChannelPlugin | undefined {
    return this.plugins.get(channelId)
  }

  getAllPlugins(): ChannelPlugin[] {
    return Array.from(this.plugins.values())
  }

  getRegisteredIds(): ChannelId[] {
    return Array.from(this.plugins.keys())
  }

  async connectAccount(channelId: ChannelId, account: ChannelAccountConfig): Promise<void> {
    const plugin = this.plugins.get(channelId)
    if (!plugin) {
      throw new Error(`Channel plugin not found: ${channelId}`)
    }
    try {
      await plugin.connect(account)
      logger.info(`[ChannelRegistry] Connected ${channelId} account: ${account.id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`[ChannelRegistry] Failed to connect ${channelId} account ${account.id}: ${errorMsg}`)
      throw err
    }
  }

  async disconnectAccount(channelId: ChannelId, accountId: string): Promise<void> {
    const plugin = this.plugins.get(channelId)
    if (!plugin) {
      throw new Error(`Channel plugin not found: ${channelId}`)
    }
    await plugin.disconnect(accountId)
    logger.info(`[ChannelRegistry] Disconnected ${channelId} account: ${accountId}`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    const plugin = this.plugins.get(message.channelId)
    if (!plugin) {
      return { success: false, error: `Channel plugin not found: ${message.channelId}` }
    }
    try {
      return await plugin.sendMessage(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`[ChannelRegistry] Send message failed on ${message.channelId}: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }

  getAccountStatus(channelId: ChannelId, accountId: string): ChannelAccountSnapshot | undefined {
    const plugin = this.plugins.get(channelId)
    if (!plugin) return undefined
    return plugin.getStatus(accountId)
  }

  getAllAccountStatuses(): ChannelAccountSnapshot[] {
    const snapshots: ChannelAccountSnapshot[] = []
    for (const plugin of this.plugins.values()) {
      for (const [accountId] of this.accountStatuses) {
        const status = plugin.getStatus(accountId)
        if (status) snapshots.push(status)
      }
    }
    return snapshots
  }

  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.push(callback)
    return () => {
      const idx = this.messageCallbacks.indexOf(callback)
      if (idx >= 0) this.messageCallbacks.splice(idx, 1)
    }
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback)
    return () => {
      const idx = this.statusCallbacks.indexOf(callback)
      if (idx >= 0) this.statusCallbacks.splice(idx, 1)
    }
  }

  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.push(callback)
    return () => {
      const idx = this.eventCallbacks.indexOf(callback)
      if (idx >= 0) this.eventCallbacks.splice(idx, 1)
    }
  }

  async startFromConfig(configs: ChannelConfig[]): Promise<void> {
    for (const config of configs) {
      if (!config.enabled) continue
      const plugin = this.plugins.get(config.id)
      if (!plugin) {
        logger.warn(`[ChannelRegistry] No plugin for channel: ${config.id}`)
        continue
      }
      for (const account of config.accounts) {
        if (!account.enabled) continue
        try {
          await this.connectAccount(config.id, account)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error(`[ChannelRegistry] Auto-connect failed for ${config.id}/${account.id}: ${errorMsg}`)
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [channelId, plugin] of this.plugins) {
      try {
        plugin.destroy()
        logger.info(`[ChannelRegistry] Stopped channel: ${channelId}`)
      } catch (err) {
        logger.error(`[ChannelRegistry] Error stopping ${channelId}: ${err}`)
      }
    }
  }

  private handleInboundMessage(message: InboundMessage): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(message)
      } catch (err) {
        logger.error(`[ChannelRegistry] Message callback error: ${err}`)
      }
    }
  }

  private handleStatusChange(snapshot: ChannelAccountSnapshot): void {
    this.accountStatuses.set(`${snapshot.accountId}`, snapshot)
    for (const cb of this.statusCallbacks) {
      try {
        cb(snapshot)
      } catch (err) {
        logger.error(`[ChannelRegistry] Status callback error: ${err}`)
      }
    }
  }

  private handleEvent(event: ChannelEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event)
      } catch (err) {
        logger.error(`[ChannelRegistry] Event callback error: ${err}`)
      }
    }
  }
}

export const channelRegistry = new ChannelRegistry()
