import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import type { ChannelConfig, ChannelId } from '@shared/types/channel'

const CONFIG_FILE_NAME = 'channels.json'

export class ChannelConfigStore {
  private configPath: string
  private configs: Map<ChannelId, ChannelConfig> = new Map()
  private loaded = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.configPath = path.join(userDataPath, CONFIG_FILE_NAME)
  }

  load(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.configs.clear()
        this.loaded = true
        logger.channel.info('No channel config file found, starting with empty config')
        return
      }
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw) as ChannelConfig[]
      this.configs.clear()
      for (const config of parsed) {
        this.configs.set(config.id, config)
      }
      this.loaded = true
      logger.channel.info(`Loaded ${this.configs.size} channel configs`)
    } catch (err) {
      logger.channel.error(`Failed to load channel config: ${err}`)
      this.configs.clear()
      this.loaded = true
    }
  }

  save(): void {
    try {
      const data = Array.from(this.configs.values())
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
      logger.channel.info('Saved channel configs')
    } catch (err) {
      logger.channel.error(`Failed to save channel config: ${err}`)
    }
  }

  getAll(): ChannelConfig[] {
    if (!this.loaded) this.load()
    return Array.from(this.configs.values())
  }

  get(channelId: ChannelId): ChannelConfig | undefined {
    if (!this.loaded) this.load()
    return this.configs.get(channelId)
  }

  set(config: ChannelConfig): void {
    this.configs.set(config.id, config)
    this.save()
  }

  update(channelId: ChannelId, partial: Partial<ChannelConfig>): void {
    const existing = this.configs.get(channelId)
    if (existing) {
      this.configs.set(channelId, { ...existing, ...partial, id: channelId })
    } else {
      this.configs.set(channelId, { ...partial, id: channelId } as ChannelConfig)
    }
    this.save()
  }

  remove(channelId: ChannelId): void {
    this.configs.delete(channelId)
    this.save()
  }

  getEnabledConfigs(): ChannelConfig[] {
    return this.getAll().filter(c => c.enabled)
  }
}

export const channelConfigStore = new ChannelConfigStore()
