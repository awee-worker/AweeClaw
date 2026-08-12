import { logger } from '@shared/toolkit/LogEngine'
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
} from '@shared/protocols/channel'

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
      logger.channel.warn(`Plugin ${plugin.id} already registered, replacing`)
    }
    this.plugins.set(plugin.id, plugin)
    plugin.onMessage(msg => this.handleInboundMessage(msg))
    plugin.onStatusChange(snapshot => this.handleStatusChange(snapshot))
    plugin.onEvent(event => this.handleEvent(event))
    logger.channel.info(`Registered channel plugin: ${plugin.id}`)
  }

  unregister(channelId: ChannelId): void {
    const plugin = this.plugins.get(channelId)
    if (plugin) {
      plugin.destroy()
      this.plugins.delete(channelId)
      logger.channel.info(`Unregistered channel plugin: ${channelId}`)
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
      logger.channel.info(`Connected ${channelId} account: ${account.id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`Failed to connect ${channelId} account ${account.id}: ${errorMsg}`)
      throw err
    }
  }

  async disconnectAccount(channelId: ChannelId, accountId: string): Promise<void> {
    const plugin = this.plugins.get(channelId)
    if (!plugin) {
      throw new Error(`Channel plugin not found: ${channelId}`)
    }
    await plugin.disconnect(accountId)
    logger.channel.info(`Disconnected ${channelId} account: ${accountId}`)
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
      logger.channel.error(`Send message failed on ${message.channelId}: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }

  getAccountStatus(channelId: ChannelId, accountId: string): ChannelAccountSnapshot | undefined {
    const plugin = this.plugins.get(channelId)
    if (!plugin) return undefined
    return plugin.getStatus(accountId)
  }

  /**
   * 获取扫码登录二维码（仅支持 qrLogin 能力的渠道）
   */
  async fetchQRCode(channelId: ChannelId): Promise<import('@shared/protocols/channel').QRCodeResult> {
    const plugin = this.plugins.get(channelId)
    if (!plugin) {
      throw new Error(`Channel plugin not found: ${channelId}`)
    }
    if (!plugin.fetchQRCode) {
      throw new Error(`Channel '${channelId}' does not support QR login`)
    }
    return plugin.fetchQRCode()
  }

  /**
   * 轮询扫码状态（仅支持 qrLogin 能力的渠道）
   */
  async pollQRStatus(channelId: ChannelId, qrcode: string): Promise<import('@shared/protocols/channel').QRPollResult> {
    const plugin = this.plugins.get(channelId)
    if (!plugin) {
      throw new Error(`Channel plugin not found: ${channelId}`)
    }
    if (!plugin.pollQRStatus) {
      throw new Error(`Channel '${channelId}' does not support QR login`)
    }
    return plugin.pollQRStatus(qrcode)
  }

  getAllAccountStatuses(): ChannelAccountSnapshot[] {
    const snapshots: ChannelAccountSnapshot[] = []
    const seen = new Set<string>()

    // 优先使用 handleStatusChange 实时更新的缓存（状态最新）
    for (const snapshot of this.accountStatuses.values()) {
      if (!seen.has(snapshot.accountId)) {
        snapshots.push(snapshot)
        seen.add(snapshot.accountId)
      }
    }

    // 补充：从各插件获取活跃连接的状态，确保不遗漏
    for (const plugin of this.plugins.values()) {
      // 尝试从插件获取所有已知账户的状态
      for (const accountId of this.accountStatuses.keys()) {
        if (seen.has(accountId)) continue
        const status = plugin.getStatus(accountId)
        if (status && status.configured) {
          snapshots.push(status)
          seen.add(accountId)
        }
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
    // 并行连接所有已启用的渠道账户，互不阻塞
    const connectTasks: Promise<void>[] = []
    for (const config of configs) {
      if (!config.enabled) continue
      const plugin = this.plugins.get(config.id)
      if (!plugin) {
        logger.channel.warn(`No plugin for channel: ${config.id}`)
        continue
      }
      for (const account of config.accounts) {
        if (!account.enabled) continue
        connectTasks.push(
          this.connectAccount(config.id, account).catch(err => {
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger.channel.error(`Auto-connect failed for ${config.id}/${account.id}: ${errorMsg}`)
          })
        )
      }
    }
    await Promise.allSettled(connectTasks)
  }

  async stopAll(): Promise<void> {
    for (const [channelId, plugin] of this.plugins) {
      try {
        plugin.destroy()
        logger.channel.info(`Stopped channel: ${channelId}`)
      } catch (err) {
        logger.channel.error(`Error stopping ${channelId}: ${err}`)
      }
    }
  }

  private handleInboundMessage(message: InboundMessage): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(message)
      } catch (err) {
        logger.channel.error(`Message callback error: ${err}`)
      }
    }
  }

  private handleStatusChange(snapshot: ChannelAccountSnapshot): void {
    this.accountStatuses.set(`${snapshot.accountId}`, snapshot)
    for (const cb of this.statusCallbacks) {
      try {
        cb(snapshot)
      } catch (err) {
        logger.channel.error(`Status callback error: ${err}`)
      }
    }
  }

  private handleEvent(event: ChannelEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event)
      } catch (err) {
        logger.channel.error(`Event callback error: ${err}`)
      }
    }
  }
}

export const channelRegistry = new ChannelRegistry()
