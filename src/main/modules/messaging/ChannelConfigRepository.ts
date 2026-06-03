/**
 * 渠道配置持久化存储
 *
 * 优先使用 SQLite 数据库（SettingsDb）存储渠道配置，
 * 首次启动时自动从 channels.json 迁移历史数据。
 *
 * 设计原则：
 * - 接口不变，上层代码无需修改
 * - 数据库为唯一真相来源，内存缓存仅加速读取
 * - 迁移完成后不再依赖 JSON 文件
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { SettingsDb } from '../settings-db/SettingsDb'
import type { ChannelConfig, ChannelId } from '@shared/protocols/channel'

const CONFIG_FILE_NAME = 'channels.json'
const MIGRATION_FLAG_KEY = 'channel_config_migrated'

export class ChannelConfigStore {
  private configPath: string
  private configs: Map<ChannelId, ChannelConfig> = new Map()
  private loaded = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.configPath = path.join(userDataPath, CONFIG_FILE_NAME)
  }

  /** 获取 SettingsDb 实例（可能尚未初始化） */
  private getDb(): SettingsDb {
    return SettingsDb.getInstance()
  }

  /** 数据库是否可用 */
  private isDbReady(): boolean {
    try {
      const db = this.getDb()
      return (db as any).db !== null
    } catch {
      return false
    }
  }

  load(): void {
    // 1. 优先从数据库加载
    if (this.isDbReady()) {
      try {
        this.loadFromDb()
        this.loaded = true
        return
      } catch (err) {
        logger.channel.warn(`[ChannelConfigStore] DB load failed, falling back to JSON: ${err}`)
      }
    }

    // 2. 回退到 JSON 文件
    this.loadFromJson()
    this.loaded = true
  }

  /** 从数据库加载渠道配置 */
  private loadFromDb(): void {
    const db = this.getDb()
    const configs = db.getAllChannelConfigs()
    this.configs.clear()
    for (const config of configs) {
      this.configs.set(config.id as ChannelId, config as ChannelConfig)
    }
    logger.channel.info(`[ChannelConfigStore] Loaded ${this.configs.size} channel configs from DB`)

    // 首次加载时，尝试从 JSON 迁移
    this.migrateFromJsonIfNeeded()
  }

  /** 从 JSON 文件加载渠道配置 */
  private loadFromJson(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.configs.clear()
        logger.channel.info('[ChannelConfigStore] No channel config file found, starting with empty config')
        return
      }
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw) as ChannelConfig[]
      this.configs.clear()
      for (const config of parsed) {
        this.configs.set(config.id, config)
      }
      logger.channel.info(`[ChannelConfigStore] Loaded ${this.configs.size} channel configs from JSON`)
    } catch (err) {
      logger.channel.error(`[ChannelConfigStore] Failed to load channel config from JSON: ${err}`)
      this.configs.clear()
    }
  }

  /** 从 channels.json 迁移到数据库（仅执行一次） */
  private migrateFromJsonIfNeeded(): void {
    const db = this.getDb()

    // 检查迁移标记
    try {
      const flag = db.getAppSetting(MIGRATION_FLAG_KEY)
      if (flag === true || flag === 'true') {
        return // 已迁移
      }
    } catch {
      // 忽略，继续迁移
    }

    // 检查 JSON 文件是否存在
    if (!fs.existsSync(this.configPath)) {
      // 无需迁移，标记为已完成
      try {
        db.upsertAppSetting(MIGRATION_FLAG_KEY, true)
      } catch { /* ignore */ }
      return
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw) as ChannelConfig[]

      if (parsed.length === 0) {
        db.upsertAppSetting(MIGRATION_FLAG_KEY, true)
        return
      }

      // 写入数据库
      for (const config of parsed) {
        db.upsertChannelConfig(config)
      }

      // 标记迁移完成
      db.upsertAppSetting(MIGRATION_FLAG_KEY, true)

      logger.channel.info(`[ChannelConfigStore] Migrated ${parsed.length} channel configs from JSON to DB`)
    } catch (err) {
      logger.channel.error(`[ChannelConfigStore] Migration from JSON failed: ${err}`)
    }
  }

  /** 持久化保存单个渠道配置 */
  private persistSingle(channelId: ChannelId): void {
    const config = this.configs.get(channelId)
    if (!config) return

    if (this.isDbReady()) {
      try {
        this.getDb().upsertChannelConfig(config)
        return
      } catch (err) {
        logger.channel.error(`[ChannelConfigStore] DB persist failed, falling back to JSON: ${err}`)
      }
    }
    this.persistToJson()
  }

  /** 保存到 JSON 文件（兜底） */
  private persistToJson(): void {
    try {
      const data = Array.from(this.configs.values())
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      logger.channel.error(`[ChannelConfigStore] Failed to save channel config to JSON: ${err}`)
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
    this.persistSingle(config.id)
  }

  update(channelId: ChannelId, partial: Partial<ChannelConfig>): void {
    const existing = this.configs.get(channelId)
    if (existing) {
      this.configs.set(channelId, { ...existing, ...partial, id: channelId })
    } else {
      this.configs.set(channelId, { ...partial, id: channelId } as ChannelConfig)
    }
    this.persistSingle(channelId)
  }

  remove(channelId: ChannelId): void {
    this.configs.delete(channelId)
    // 从数据库删除
    if (this.isDbReady()) {
      try {
        this.getDb().deleteChannelConfig(channelId)
      } catch (err) {
        logger.channel.error(`[ChannelConfigStore] Failed to delete channel config from DB: ${err}`)
      }
    }
    // JSON 兜底：全量写入
    this.persistToJson()
  }

  getEnabledConfigs(): ChannelConfig[] {
    return this.getAll().filter(c => c.enabled)
  }
}

export const channelConfigStore = new ChannelConfigStore()
