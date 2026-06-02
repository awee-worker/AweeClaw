/**
 * 设置数据库模块
 *
 * 使用 node:sqlite (DatabaseSync) 管理全局设置数据。
 * 数据库路径: {userDataPath}/.aweeclaw/db/settings.db
 *
 * 设计原则:
 * - 每个 provider 配置独立一行，彻底隔离，杜绝串数据
 * - 通用设置使用键值表存储
 * - 事务保证原子写入
 * - 自动从旧版 JSON 格式迁移
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// ============================================
// 类型定义
// ============================================

export interface ProviderConfigRow {
  provider_id: string
  api_key: string
  base_url: string
  model: string
  timeout: number
  custom_models: string       // JSON 数组字符串
  headers: string             // JSON 对象字符串
  openai_compatibility_profile: string
  protocol: string
  display_name: string
  model_configs: string       // JSON 对象字符串
  enabled: number             // 0 | 1
  is_current: number          // 0 | 1，标记当前活跃 provider
  created_at: number
  updated_at: number
}

export interface SettingRow {
  key: string
  value: string               // JSON 字符串
  updated_at: number
}

export interface LlmBehaviorRow {
  key: string
  value: string               // JSON 字符串
  updated_at: number
}

// ============================================
// 数据库路径
// ============================================

function getDbDir(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, '.aweeclaw', 'db')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'settings.db')
}

// ============================================
// SettingsDb 类
// ============================================

export class SettingsDb {
  private db: any = null
  private dbPath: string = ''
  private static instance: SettingsDb | null = null

  private constructor() {}

  static getInstance(): SettingsDb {
    if (!SettingsDb.instance) {
      SettingsDb.instance = new SettingsDb()
    }
    return SettingsDb.instance
  }

  /** 初始化数据库：创建目录、打开连接、建表 */
  async initialize(): Promise<void> {
    this.dbPath = getDbPath()
    const dbDir = getDbDir()

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    try {
      const { DatabaseSync } = await import('node:sqlite')
      this.db = new DatabaseSync(this.dbPath, { open: true })
      this.db.exec('PRAGMA journal_mode=WAL')
      this.db.exec('PRAGMA foreign_keys=ON')
      this.db.exec('PRAGMA busy_timeout=5000')

      this.createTables()

      logger.settings.info(`[SettingsDb] Initialized at ${this.dbPath}`)
    } catch (err) {
      logger.settings.error('[SettingsDb] Failed to initialize:', err)
      throw err
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
        this.db = null
        logger.settings.info('[SettingsDb] Closed')
      } catch (err) {
        logger.settings.error('[SettingsDb] Failed to close:', err)
      }
    }
  }

  /** 获取数据库路径（供外部查询） */
  getDbPath(): string {
    return this.dbPath
  }

  // ============================================
  // 建表
  // ============================================

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_config (
        provider_id    TEXT PRIMARY KEY NOT NULL,
        api_key        TEXT NOT NULL DEFAULT '',
        base_url       TEXT NOT NULL DEFAULT '',
        model          TEXT NOT NULL DEFAULT '',
        timeout        INTEGER NOT NULL DEFAULT 120000,
        custom_models  TEXT NOT NULL DEFAULT '[]',
        headers        TEXT NOT NULL DEFAULT '{}',
        openai_compatibility_profile TEXT NOT NULL DEFAULT 'full',
        protocol       TEXT NOT NULL DEFAULT 'openai',
        display_name   TEXT NOT NULL DEFAULT '',
        model_configs  TEXT NOT NULL DEFAULT '{}',
        enabled        INTEGER NOT NULL DEFAULT 1,
        is_current     INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_behavior (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL DEFAULT ''
      )
    `)

    // 标记 schema 版本
    const existingVersion = this.db.prepare("SELECT value FROM schema_version WHERE key = 'version'").get() as any
    if (!existingVersion) {
      this.db.prepare("INSERT INTO schema_version (key, value) VALUES ('version', '1')").run()
    }
  }

  // ============================================
  // Provider 配置 CRUD
  // ============================================

  /** 获取所有 provider 配置 */
  getAllProviderConfigs(): Record<string, any> {
    const rows = this.db.prepare('SELECT * FROM provider_config').all() as ProviderConfigRow[]
    const result: Record<string, any> = {}

    for (const row of rows) {
      result[row.provider_id] = this.rowToProviderConfig(row)
    }

    return result
  }

  /** 获取单个 provider 配置 */
  getProviderConfig(providerId: string): any | null {
    const row = this.db.prepare('SELECT * FROM provider_config WHERE provider_id = ?').get(providerId) as ProviderConfigRow | undefined
    return row ? this.rowToProviderConfig(row) : null
  }

  /** 获取当前活跃 provider ID */
  getCurrentProviderId(): string | null {
    const row = this.db.prepare('SELECT provider_id FROM provider_config WHERE is_current = 1').get() as { provider_id: string } | undefined
    return row?.provider_id ?? null
  }

  /** 保存/更新单个 provider 配置 */
  upsertProviderConfig(providerId: string, config: any, isCurrent: boolean): void {
    const now = Date.now()
    const existing = this.db.prepare('SELECT provider_id FROM provider_config WHERE provider_id = ?').get(providerId) as any

    const apiKey = config.apiKey ?? ''
    const baseUrl = config.baseUrl ?? ''
    const model = config.model ?? ''
    const timeout = config.timeout ?? 120000
    const customModels = JSON.stringify(config.customModels ?? [])
    const headers = JSON.stringify(config.headers ?? {})
    const openAICompatibilityProfile = config.openAICompatibilityProfile ?? 'full'
    const protocol = config.protocol ?? 'openai'
    const displayName = config.displayName ?? ''
    const modelConfigs = JSON.stringify(config.modelConfigs ?? {})
    const enabled = config.enabled !== false ? 1 : 0

    if (isCurrent) {
      // 先清除其他 provider 的 is_current 标记
      this.db.prepare('UPDATE provider_config SET is_current = 0 WHERE is_current = 1').run()
    }

    if (existing) {
      this.db.prepare(`
        UPDATE provider_config
        SET api_key = ?, base_url = ?, model = ?, timeout = ?,
            custom_models = ?, headers = ?, openai_compatibility_profile = ?,
            protocol = ?, display_name = ?, model_configs = ?,
            enabled = ?, is_current = ?, updated_at = ?
        WHERE provider_id = ?
      `).run(
        apiKey, baseUrl, model, timeout,
        customModels, headers, openAICompatibilityProfile,
        protocol, displayName, modelConfigs,
        enabled, isCurrent ? 1 : 0, now,
        providerId,
      )
    } else {
      this.db.prepare(`
        INSERT INTO provider_config (
          provider_id, api_key, base_url, model, timeout,
          custom_models, headers, openai_compatibility_profile,
          protocol, display_name, model_configs, enabled,
          is_current, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        providerId, apiKey, baseUrl, model, timeout,
        customModels, headers, openAICompatibilityProfile,
        protocol, displayName, modelConfigs, enabled,
        isCurrent ? 1 : 0, now, now,
      )
    }
  }

  /** 批量保存 provider 配置（事务） */
  batchUpsertProviderConfigs(configs: Record<string, any>, currentProviderId: string): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()

      // 清除所有 is_current
      this.db.prepare('UPDATE provider_config SET is_current = 0').run()

      for (const [id, config] of Object.entries(configs)) {
        this.upsertProviderConfig(id, config, id === currentProviderId)
      }

      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.settings.error('[SettingsDb] batchUpsertProviderConfigs failed:', err)
      throw err
    }
  }

  /** 删除 provider 配置 */
  deleteProviderConfig(providerId: string): void {
    this.db.prepare('DELETE FROM provider_config WHERE provider_id = ?').run(providerId)
  }

  // ============================================
  // LLM 行为参数
  // ============================================

  /** 获取所有 LLM 行为参数 */
  getAllLlmBehavior(): Record<string, any> {
    const rows = this.db.prepare('SELECT * FROM llm_behavior').all() as LlmBehaviorRow[]
    const result: Record<string, any> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  /** 保存 LLM 行为参数 */
  upsertLlmBehavior(key: string, value: any): void {
    const now = Date.now()
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value)
    const existing = this.db.prepare('SELECT key FROM llm_behavior WHERE key = ?').get(key) as any

    if (existing) {
      this.db.prepare('UPDATE llm_behavior SET value = ?, updated_at = ? WHERE key = ?').run(jsonValue, now, key)
    } else {
      this.db.prepare('INSERT INTO llm_behavior (key, value, updated_at) VALUES (?, ?, ?)').run(key, jsonValue, now)
    }
  }

  /** 批量保存 LLM 行为参数（事务） */
  batchUpsertLlmBehavior(behaviors: Record<string, any>): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      for (const [key, value] of Object.entries(behaviors)) {
        this.upsertLlmBehavior(key, value)
      }
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.settings.error('[SettingsDb] batchUpsertLlmBehavior failed:', err)
      throw err
    }
  }

  // ============================================
  // 通用应用设置
  // ============================================

  /** 获取所有应用设置 */
  getAllAppSettings(): Record<string, any> {
    const rows = this.db.prepare('SELECT * FROM app_settings').all() as SettingRow[]
    const result: Record<string, any> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  /** 获取单个应用设置 */
  getAppSetting(key: string): any | null {
    const row = this.db.prepare('SELECT * FROM app_settings WHERE key = ?').get(key) as SettingRow | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }

  /** 保存/更新应用设置 */
  upsertAppSetting(key: string, value: any): void {
    const now = Date.now()
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value)
    const existing = this.db.prepare('SELECT key FROM app_settings WHERE key = ?').get(key) as any

    if (existing) {
      this.db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(jsonValue, now, key)
    } else {
      this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, jsonValue, now)
    }
  }

  /** 批量保存应用设置（事务） */
  batchUpsertAppSettings(settings: Record<string, any>): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      for (const [key, value] of Object.entries(settings)) {
        this.upsertAppSetting(key, value)
      }
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.settings.error('[SettingsDb] batchUpsertAppSettings failed:', err)
      throw err
    }
  }

  /** 删除应用设置 */
  deleteAppSetting(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  }

  // ============================================
  // 全量导出/导入（用于数据迁移和备份）
  // ============================================

  /** 导出全部数据为 JSON 兼容格式 */
  exportAll(): {
    providerConfigs: Record<string, any>
    llmBehavior: Record<string, any>
    appSettings: Record<string, any>
  } {
    return {
      providerConfigs: this.getAllProviderConfigs(),
      llmBehavior: this.getAllLlmBehavior(),
      appSettings: this.getAllAppSettings(),
    }
  }

  /** 清空所有表 */
  truncateAll(): void {
    this.db.prepare('DELETE FROM provider_config').run()
    this.db.prepare('DELETE FROM llm_behavior').run()
    this.db.prepare('DELETE FROM app_settings').run()
  }

  // ============================================
  // 内部工具方法
  // ============================================

  private rowToProviderConfig(row: ProviderConfigRow): any {
    let customModels: string[] = []
    try {
      customModels = JSON.parse(row.custom_models)
    } catch { /* ignore */ }

    let headers: Record<string, string> = {}
    try {
      headers = JSON.parse(row.headers)
    } catch { /* ignore */ }

    let modelConfigs: Record<string, any> = {}
    try {
      modelConfigs = JSON.parse(row.model_configs)
    } catch { /* ignore */ }

    return {
      apiKey: row.api_key || undefined,
      baseUrl: row.base_url || undefined,
      model: row.model || undefined,
      timeout: row.timeout,
      customModels,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      openAICompatibilityProfile: row.openai_compatibility_profile || undefined,
      protocol: row.protocol || undefined,
      displayName: row.display_name || undefined,
      modelConfigs: Object.keys(modelConfigs).length > 0 ? modelConfigs : undefined,
      enabled: row.enabled === 1,
      isCurrent: row.is_current === 1,
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
    }
  }
}
