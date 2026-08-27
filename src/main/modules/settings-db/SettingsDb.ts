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
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { encryptString, decryptString } from '../../guard/safeStorageUtil'

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

/** 视觉模型配置行（单行表，id 固定为 1） */
export interface VisionModelConfigRow {
  id: number
  provider: string
  model: string
  api_key: string             // 加密存储
  base_url: string
  timeout: number
  protocol: string
  openai_compatibility_profile: string
  headers: string             // JSON 对象字符串
  enabled: number             // 0 | 1
  cloud_mode: number          // 0=自定义模式 1=云端模式
  updated_at: number
}

/** 语音模型配置行（STT + TTS 合并一行，id=1） */
export interface VoiceModelConfigRow {
  id: number
  mode: string                 // 'split' | 'realtime'
  stt_enabled: number         // 0 | 1
  stt_provider: string
  stt_model: string
  stt_api_key: string         // 加密存储
  stt_base_url: string
  stt_language: string        // 'auto' | 'zh' | 'en' | ...
  stt_timeout: number
  tts_enabled: number         // 0 | 1
  tts_provider: string
  tts_model: string
  tts_voice: string
  tts_api_key: string         // 加密存储
  tts_base_url: string
  tts_speed: number
  tts_timeout: number
  // 端到端实时语音模型字段
  realtime_enabled: number    // 0 | 1
  realtime_provider: string
  realtime_model: string
  realtime_api_key: string    // 加密存储
  realtime_base_url: string
  realtime_voice: string
  realtime_timeout: number
  cloud_mode: number          // 0=自定义模式 1=云端模式
  updated_at: number
}

/** 语音模型配置（已解密、字段已规范化，供上层使用） */
export interface VoiceModelConfig {
  mode: 'split' | 'realtime'   // 拆分式（STT+LLM+TTS）或端到端实时
  sttEnabled: boolean
  sttProvider: string
  sttModel: string
  sttApiKey: string
  sttBaseUrl: string
  sttLanguage: string
  sttTimeout: number
  ttsEnabled: boolean
  ttsProvider: string
  ttsModel: string
  ttsVoice: string
  ttsApiKey: string
  ttsBaseUrl: string
  ttsSpeed: number
  ttsTimeout: number
  // 端到端实时语音模型
  realtimeEnabled: boolean
  realtimeProvider: string
  realtimeModel: string
  realtimeApiKey: string
  realtimeBaseUrl: string
  realtimeVoice: string
  realtimeTimeout: number
  /** 云端模式（使用后端配置） / 自定义模式（本地配置直连） */
  cloudMode: 'cloud' | 'local'
  updatedAt: number
}

/** 语音唤醒配置行（单行表，id=1） */
export interface WakeWordConfigRow {
  id: number
  enabled: number            // 0 | 1
  keyword: string            // 唤醒词，如「小喵小喵」
  sensitivity: string        // 'strict' | 'balanced' | 'loose'
  cooldown_ms: number        // 命中后冷却时长（ms）
  min_speech_ms: number      // 最短说话时长（ms），过滤噪音
  updated_at: number
}

/** 语音唤醒配置（已规范化，供上层使用） */
export interface WakeWordConfig {
  enabled: boolean
  keyword: string
  sensitivity: 'strict' | 'balanced' | 'loose'
  cooldownMs: number
  minSpeechMs: number
  updatedAt: number
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
    // 防止重复初始化
    if (this.db) {
      logger.settings.info('[SettingsDb] Already initialized, skipping')
      return
    }

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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_config (
        channel_id       TEXT PRIMARY KEY NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        default_account  TEXT NOT NULL DEFAULT '',
        created_at       INTEGER NOT NULL DEFAULT 0,
        updated_at       INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_account (
        account_id       TEXT PRIMARY KEY NOT NULL,
        channel_id       TEXT NOT NULL,
        name             TEXT NOT NULL DEFAULT '',
        enabled          INTEGER NOT NULL DEFAULT 1,
        credentials      TEXT NOT NULL DEFAULT '{}',
        connection_mode  TEXT NOT NULL DEFAULT '',
        dm_policy        TEXT NOT NULL DEFAULT '',
        allow_from       TEXT NOT NULL DEFAULT '[]',
        group_policy     TEXT NOT NULL DEFAULT '',
        group_allow_from TEXT NOT NULL DEFAULT '[]',
        groups           TEXT NOT NULL DEFAULT '{}',
        llm_config       TEXT NOT NULL DEFAULT '{}',
        created_at       INTEGER NOT NULL DEFAULT 0,
        updated_at       INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_account_channel_id
      ON channel_account (channel_id)
    `)

    // 视觉模型独立配置表（自定义模式下使用）
    // 与 provider_config 分离，避免视觉模型与聊天模型配置互相干扰
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vision_model_config (
        id                          INTEGER PRIMARY KEY CHECK (id = 1),
        provider                    TEXT NOT NULL DEFAULT '',
        model                       TEXT NOT NULL DEFAULT '',
        api_key                     TEXT NOT NULL DEFAULT '',
        base_url                    TEXT NOT NULL DEFAULT '',
        timeout                     INTEGER NOT NULL DEFAULT 120000,
        protocol                    TEXT NOT NULL DEFAULT 'openai',
        openai_compatibility_profile TEXT NOT NULL DEFAULT 'full',
        headers                     TEXT NOT NULL DEFAULT '{}',
        enabled                     INTEGER NOT NULL DEFAULT 0,
        cloud_mode                  INTEGER NOT NULL DEFAULT 1,
        updated_at                  INTEGER NOT NULL DEFAULT 0
      )
    `)

    // 兼容旧表：vision_model_config 可能已存在但缺少 cloud_mode 字段
    this.migrateVisionModelConfigSchema()

    // 语音模型独立配置表（自定义模式下使用）
    // 拆分 STT（语音识别）与 TTS（语音合成）两部分，分别可启用
    // 与视觉模型一样，与聊天模型配置隔离，避免互相干扰
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS voice_model_config (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        mode            TEXT NOT NULL DEFAULT 'split',
        stt_enabled     INTEGER NOT NULL DEFAULT 0,
        stt_provider    TEXT NOT NULL DEFAULT 'openai',
        stt_model       TEXT NOT NULL DEFAULT 'whisper-1',
        stt_api_key     TEXT NOT NULL DEFAULT '',
        stt_base_url    TEXT NOT NULL DEFAULT '',
        stt_language    TEXT NOT NULL DEFAULT 'auto',
        stt_timeout     INTEGER NOT NULL DEFAULT 120000,
        tts_enabled     INTEGER NOT NULL DEFAULT 0,
        tts_provider    TEXT NOT NULL DEFAULT 'openai',
        tts_model       TEXT NOT NULL DEFAULT 'tts-1',
        tts_voice       TEXT NOT NULL DEFAULT 'alloy',
        tts_api_key     TEXT NOT NULL DEFAULT '',
        tts_base_url    TEXT NOT NULL DEFAULT '',
        tts_speed       REAL NOT NULL DEFAULT 1.0,
        tts_timeout     INTEGER NOT NULL DEFAULT 120000,
        realtime_enabled  INTEGER NOT NULL DEFAULT 0,
        realtime_provider TEXT NOT NULL DEFAULT 'openai',
        realtime_model   TEXT NOT NULL DEFAULT 'gpt-4o-realtime',
        realtime_api_key TEXT NOT NULL DEFAULT '',
        realtime_base_url TEXT NOT NULL DEFAULT '',
        realtime_voice   TEXT NOT NULL DEFAULT 'alloy',
        realtime_timeout INTEGER NOT NULL DEFAULT 120000,
        cloud_mode       INTEGER NOT NULL DEFAULT 1,
        updated_at      INTEGER NOT NULL DEFAULT 0
      )
    `)

    // 兼容旧表：如果 voice_model_config 已存在但缺少新字段，用 ALTER TABLE 补齐
    this.migrateVoiceModelConfigSchema()

    // 语音唤醒配置表（单行，id=1）
    // 与语音模型配置分离：唤醒是独立开关，不依赖 STT/TTS 启用状态
    // keyword 不加密（非敏感），sensitivity 三档：strict / balanced / loose
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wake_word_config (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        enabled         INTEGER NOT NULL DEFAULT 0,
        keyword         TEXT NOT NULL DEFAULT '小喵小喵',
        sensitivity     TEXT NOT NULL DEFAULT 'balanced',
        cooldown_ms     INTEGER NOT NULL DEFAULT 8000,
        min_speech_ms   INTEGER NOT NULL DEFAULT 300,
        updated_at      INTEGER NOT NULL DEFAULT 0
      )
    `)

    // 兼容旧表：补齐后续版本可能新增的唤醒字段
    this.migrateWakeWordConfigSchema()

    // 确保默认行存在（id=1）。
    // 必须插入：setWakeWordEnabled/getWakeWordConfig 依赖该行，否则无行时
    // UPDATE no-op、SELECT 返回 null，导致右键菜单唤醒开关切换不生效。
    this.db.prepare(`
      INSERT OR IGNORE INTO wake_word_config
        (id, enabled, keyword, sensitivity, cooldown_ms, min_speech_ms, updated_at)
      VALUES (1, 0, '小喵小喵', 'balanced', 8000, 300, 0)
    `).run()

    // 标记 schema 版本
    const existingVersion = this.db.prepare("SELECT value FROM schema_version WHERE key = 'version'").get() as any
    if (!existingVersion) {
      this.db.prepare("INSERT INTO schema_version (key, value) VALUES ('version', '2')").run()
    }
  }

  /**
   * 语音模型配置表 schema 迁移
   * 兼容 v1（仅 STT/TTS）→ v2（新增 mode + realtime_* 字段）
   * 使用 ALTER TABLE ADD COLUMN，保留现有数据
   */
  private migrateVoiceModelConfigSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(voice_model_config)").all() as { name: string }[]
    const columnNames = new Set(columns.map(c => c.name))

    const newColumns: { name: string; def: string }[] = [
      { name: 'mode', def: "TEXT NOT NULL DEFAULT 'split'" },
      { name: 'realtime_enabled', def: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'realtime_provider', def: "TEXT NOT NULL DEFAULT 'openai'" },
      { name: 'realtime_model', def: "TEXT NOT NULL DEFAULT 'gpt-4o-realtime'" },
      { name: 'realtime_api_key', def: "TEXT NOT NULL DEFAULT ''" },
      { name: 'realtime_base_url', def: "TEXT NOT NULL DEFAULT ''" },
      { name: 'realtime_voice', def: "TEXT NOT NULL DEFAULT 'alloy'" },
      { name: 'realtime_timeout', def: 'INTEGER NOT NULL DEFAULT 120000' },
      { name: 'cloud_mode', def: 'INTEGER NOT NULL DEFAULT 1' },
    ]

    for (const col of newColumns) {
      if (!columnNames.has(col.name)) {
        this.db.exec(`ALTER TABLE voice_model_config ADD COLUMN ${col.name} ${col.def}`)
      }
    }
  }

  /**
   * 语音唤醒配置表 schema 迁移
   * 使用 ALTER TABLE ADD COLUMN 补齐后续版本新增字段，保留现有数据
   */
  private migrateWakeWordConfigSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(wake_word_config)").all() as { name: string }[]
    const columnNames = new Set(columns.map(c => c.name))

    const newColumns: { name: string; def: string }[] = [
      { name: 'cooldown_ms', def: 'INTEGER NOT NULL DEFAULT 8000' },
      { name: 'min_speech_ms', def: 'INTEGER NOT NULL DEFAULT 300' },
    ]

    for (const col of newColumns) {
      if (!columnNames.has(col.name)) {
        this.db.exec(`ALTER TABLE wake_word_config ADD COLUMN ${col.name} ${col.def}`)
      }
    }
  }

  /**
   * 视觉模型配置表 schema 迁移
   * 兼容旧表（无 cloud_mode 字段）→ 新增独立云端/自定义模式开关
   * 使用 ALTER TABLE ADD COLUMN，保留现有数据
   */
  private migrateVisionModelConfigSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(vision_model_config)").all() as { name: string }[]
    const columnNames = new Set(columns.map(c => c.name))

    const newColumns: { name: string; def: string }[] = [
      { name: 'cloud_mode', def: 'INTEGER NOT NULL DEFAULT 1' },
    ]

    for (const col of newColumns) {
      if (!columnNames.has(col.name)) {
        this.db.exec(`ALTER TABLE vision_model_config ADD COLUMN ${col.name} ${col.def}`)
      }
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

    // API Key 加密存储，防止 SQLite 文件被直接读取泄露密钥
    const apiKey = config.apiKey ? encryptString(config.apiKey) : ''
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
  // 视觉模型配置 CRUD（自定义模式下使用）
  // 单行表（id=1），保证全局唯一配置
  // ============================================

  /** 获取视觉模型配置（已解密 apiKey、解析 headers） */
  getVisionModelConfig(): any | null {
    const row = this.db.prepare('SELECT * FROM vision_model_config WHERE id = 1').get() as VisionModelConfigRow | undefined
    return row ? this.rowToVisionModelConfig(row) : null
  }

  /** 保存视觉模型配置（upsert） */
  /** 保存视觉模型配置（upsert） */
  upsertVisionModelConfig(config: {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number
    protocol?: string
    openaiCompatibilityProfile?: string
    headers?: Record<string, string>
    enabled?: boolean
    /** 0=自定义模式 1=云端模式（独立于服务商 cloudMode） */
    cloudMode?: 'cloud' | 'local'
  }): void {
    const now = Date.now()
    const headersJson = JSON.stringify(config.headers ?? {})
    const encryptedApiKey = config.apiKey ? encryptString(config.apiKey) : ''
    this.db.prepare(`
      INSERT INTO vision_model_config (
        id, provider, model, api_key, base_url, timeout,
        protocol, openai_compatibility_profile, headers, enabled, cloud_mode, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        api_key = excluded.api_key,
        base_url = excluded.base_url,
        timeout = excluded.timeout,
        protocol = excluded.protocol,
        openai_compatibility_profile = excluded.openai_compatibility_profile,
        headers = excluded.headers,
        enabled = excluded.enabled,
        cloud_mode = excluded.cloud_mode,
        updated_at = excluded.updated_at
    `).run(
      config.provider,
      config.model,
      encryptedApiKey,
      config.baseUrl ?? '',
      config.timeout ?? 120000,
      config.protocol ?? 'openai',
      config.openaiCompatibilityProfile ?? 'full',
      headersJson,
      config.enabled ? 1 : 0,
      config.cloudMode === 'local' ? 0 : 1,
      now,
    )
  }

  /** 仅更新启用状态 */
  setVisionModelEnabled(enabled: boolean): void {
    this.db.prepare('UPDATE vision_model_config SET enabled = ?, updated_at = ? WHERE id = 1').run(enabled ? 1 : 0, Date.now())
  }

  // ============================================
  // 语音模型配置 CRUD（自定义模式下使用）
  // ============================================

  /** 获取语音模型配置（已解密 apiKey） */
  getVoiceModelConfig(): VoiceModelConfig | null {
    const row = this.db.prepare('SELECT * FROM voice_model_config WHERE id = 1').get() as VoiceModelConfigRow | undefined
    return row ? this.rowToVoiceModelConfig(row) : null
  }

  /** 行转对象（解密 api_key，规范化字段） */
  /** 行转对象（解密 api_key，规范化字段） */
  private rowToVoiceModelConfig(row: VoiceModelConfigRow): VoiceModelConfig {
    return {
      mode: (row.mode as 'split' | 'realtime') || 'split',
      sttEnabled: row.stt_enabled === 1,
      sttProvider: row.stt_provider || 'openai',
      sttModel: row.stt_model || 'whisper-1',
      sttApiKey: row.stt_api_key ? decryptString(row.stt_api_key) || '' : '',
      sttBaseUrl: row.stt_base_url || '',
      sttLanguage: row.stt_language || 'auto',
      sttTimeout: row.stt_timeout || 120000,
      ttsEnabled: row.tts_enabled === 1,
      ttsProvider: row.tts_provider || 'openai',
      ttsModel: row.tts_model || 'tts-1',
      ttsVoice: row.tts_voice || 'alloy',
      ttsApiKey: row.tts_api_key ? decryptString(row.tts_api_key) || '' : '',
      ttsBaseUrl: row.tts_base_url || '',
      ttsSpeed: row.tts_speed ?? 1.0,
      ttsTimeout: row.tts_timeout || 120000,
      realtimeEnabled: row.realtime_enabled === 1,
      realtimeProvider: row.realtime_provider || 'openai',
      realtimeModel: row.realtime_model || 'gpt-4o-realtime',
      realtimeApiKey: row.realtime_api_key ? decryptString(row.realtime_api_key) || '' : '',
      realtimeBaseUrl: row.realtime_base_url || '',
      realtimeVoice: row.realtime_voice || 'alloy',
      realtimeTimeout: row.realtime_timeout || 120000,
      /** 独立云端/自定义模式（不随服务商 cloudMode） */
      cloudMode: row.cloud_mode === 1 ? 'cloud' : 'local',
      updatedAt: row.updated_at,
    }
  }

  /** 保存语音模型配置（upsert，STT / TTS / Realtime 一并写入） */
  /** 保存语音模型配置（upsert，STT / TTS / Realtime 一并写入） */
  upsertVoiceModelConfig(config: {
    mode?: 'split' | 'realtime'
    sttEnabled?: boolean
    sttProvider?: string
    sttModel?: string
    sttApiKey?: string
    sttBaseUrl?: string
    sttLanguage?: string
    sttTimeout?: number
    ttsEnabled?: boolean
    ttsProvider?: string
    ttsModel?: string
    ttsVoice?: string
    ttsApiKey?: string
    ttsBaseUrl?: string
    ttsSpeed?: number
    ttsTimeout?: number
    realtimeEnabled?: boolean
    realtimeProvider?: string
    realtimeModel?: string
    realtimeApiKey?: string
    realtimeBaseUrl?: string
    realtimeVoice?: string
    realtimeTimeout?: number
    /** 0=自定义模式 1=云端模式（独立于服务商 cloudMode） */
    cloudMode?: 'cloud' | 'local'
  }): void {
    const now = Date.now()
    const encryptedSttKey = config.sttApiKey ? encryptString(config.sttApiKey) : ''
    const encryptedTtsKey = config.ttsApiKey ? encryptString(config.ttsApiKey) : ''
    const encryptedRealtimeKey = config.realtimeApiKey ? encryptString(config.realtimeApiKey) : ''
    this.db.prepare(`
      INSERT INTO voice_model_config (
        id, mode,
        stt_enabled, stt_provider, stt_model, stt_api_key, stt_base_url, stt_language, stt_timeout,
        tts_enabled, tts_provider, tts_model, tts_voice, tts_api_key, tts_base_url, tts_speed, tts_timeout,
        realtime_enabled, realtime_provider, realtime_model, realtime_api_key, realtime_base_url, realtime_voice, realtime_timeout,
        cloud_mode, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mode              = excluded.mode,
        stt_enabled       = excluded.stt_enabled,
        stt_provider      = excluded.stt_provider,
        stt_model         = excluded.stt_model,
        stt_api_key       = excluded.stt_api_key,
        stt_base_url      = excluded.stt_base_url,
        stt_language      = excluded.stt_language,
        stt_timeout       = excluded.stt_timeout,
        tts_enabled       = excluded.tts_enabled,
        tts_provider      = excluded.tts_provider,
        tts_model         = excluded.tts_model,
        tts_voice         = excluded.tts_voice,
        tts_api_key       = excluded.tts_api_key,
        tts_base_url      = excluded.tts_base_url,
        tts_speed         = excluded.tts_speed,
        tts_timeout       = excluded.tts_timeout,
        realtime_enabled  = excluded.realtime_enabled,
        realtime_provider = excluded.realtime_provider,
        realtime_model    = excluded.realtime_model,
        realtime_api_key  = excluded.realtime_api_key,
        realtime_base_url = excluded.realtime_base_url,
        realtime_voice    = excluded.realtime_voice,
        realtime_timeout  = excluded.realtime_timeout,
        cloud_mode        = excluded.cloud_mode,
        updated_at        = excluded.updated_at
    `).run(
      config.mode ?? 'split',
      config.sttEnabled ? 1 : 0,
      config.sttProvider ?? 'openai',
      config.sttModel ?? 'whisper-1',
      encryptedSttKey,
      config.sttBaseUrl ?? '',
      config.sttLanguage ?? 'auto',
      config.sttTimeout ?? 120000,
      config.ttsEnabled ? 1 : 0,
      config.ttsProvider ?? 'openai',
      config.ttsModel ?? 'tts-1',
      config.ttsVoice ?? 'alloy',
      encryptedTtsKey,
      config.ttsBaseUrl ?? '',
      config.ttsSpeed ?? 1.0,
      config.ttsTimeout ?? 120000,
      config.realtimeEnabled ? 1 : 0,
      config.realtimeProvider ?? 'openai',
      config.realtimeModel ?? 'gpt-4o-realtime',
      encryptedRealtimeKey,
      config.realtimeBaseUrl ?? '',
      config.realtimeVoice ?? 'alloy',
      config.realtimeTimeout ?? 120000,
      config.cloudMode === 'local' ? 0 : 1,
      now,
    )
  }

  /** 仅更新 STT/TTS 启用状态 */
  setVoiceModelEnabled(sttEnabled: boolean, ttsEnabled: boolean): void {
    this.db.prepare(
      'UPDATE voice_model_config SET stt_enabled = ?, tts_enabled = ?, updated_at = ? WHERE id = 1',
    ).run(sttEnabled ? 1 : 0, ttsEnabled ? 1 : 0, Date.now())
  }

  // ============================================
  // 语音唤醒配置 CRUD
  // ============================================

  /** 获取语音唤醒配置 */
  getWakeWordConfig(): WakeWordConfig | null {
    const row = this.db.prepare('SELECT * FROM wake_word_config WHERE id = 1').get() as WakeWordConfigRow | undefined
    return row ? this.rowToWakeWordConfig(row) : null
  }

  /** 行转对象（规范化 sensitivity 枚举与字段命名） */
  private rowToWakeWordConfig(row: WakeWordConfigRow): WakeWordConfig {
    const sensitivity = row.sensitivity === 'strict' || row.sensitivity === 'loose'
      ? row.sensitivity
      : 'balanced'
    return {
      enabled: row.enabled === 1,
      keyword: row.keyword || '小喵小喵',
      sensitivity,
      cooldownMs: row.cooldown_ms ?? 8000,
      minSpeechMs: row.min_speech_ms ?? 300,
      updatedAt: row.updated_at,
    }
  }

  /** 保存语音唤醒配置（upsert） */
  upsertWakeWordConfig(config: {
    enabled?: boolean
    keyword?: string
    sensitivity?: 'strict' | 'balanced' | 'loose'
    cooldownMs?: number
    minSpeechMs?: number
  }): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO wake_word_config (
        id, enabled, keyword, sensitivity, cooldown_ms, min_speech_ms, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled       = excluded.enabled,
        keyword       = excluded.keyword,
        sensitivity   = excluded.sensitivity,
        cooldown_ms   = excluded.cooldown_ms,
        min_speech_ms = excluded.min_speech_ms,
        updated_at    = excluded.updated_at
    `).run(
      (config.enabled ? 1 : 0),
      config.keyword ?? '小喵小喵',
      config.sensitivity ?? 'balanced',
      config.cooldownMs ?? 8000,
      config.minSpeechMs ?? 300,
      now,
    )
  }

  /** 仅更新唤醒启用状态（upsert，保证无行时也能写入） */
  setWakeWordEnabled(enabled: boolean): void {
    // 使用 INSERT ... ON CONFLICT upsert，避免无默认行时 UPDATE 影响 0 行导致切换不生效。
    // 保留已有行的 keyword/sensitivity 等字段（用 COALESCE 取旧值）。
    this.db.prepare(`
      INSERT INTO wake_word_config
        (id, enabled, keyword, sensitivity, cooldown_ms, min_speech_ms, updated_at)
      VALUES (1, ?, '小喵小喵', 'balanced', 8000, 300, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled    = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(enabled ? 1 : 0, Date.now())
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
      apiKey: row.api_key ? decryptString(row.api_key) || undefined : undefined,
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

  /** 将视觉模型配置行转换为业务对象 */
  private rowToVisionModelConfig(row: VisionModelConfigRow): any {
    let headers: Record<string, string> = {}
    try {
      headers = JSON.parse(row.headers)
    } catch { /* ignore */ }

    return {
      provider: row.provider,
      model: row.model,
      apiKey: row.api_key ? decryptString(row.api_key) || '' : '',
      baseUrl: row.base_url || '',
      timeout: row.timeout,
      protocol: row.protocol || 'openai',
      openAICompatibilityProfile: row.openai_compatibility_profile || 'full',
      headers: Object.keys(headers).length > 0 ? headers : {},
      enabled: row.enabled === 1,
      /** 独立云端/自定义模式（不随服务商 cloudMode） */
      cloudMode: row.cloud_mode === 1 ? 'cloud' : 'local',
      updatedAt: row.updated_at,
    }
  }

  // ============================================
  // 渠道配置 CRUD
  // ============================================

  /** 获取所有渠道配置（含账户列表） */
  getAllChannelConfigs(): Array<{ id: string; enabled: boolean; defaultAccount?: string; accounts: any[] }> {
    const channelRows = this.db.prepare('SELECT * FROM channel_config').all() as any[]
    const result: Array<{ id: string; enabled: boolean; defaultAccount?: string; accounts: any[] }> = []

    for (const ch of channelRows) {
      const accounts = this.getChannelAccounts(ch.channel_id)
      result.push({
        id: ch.channel_id,
        enabled: ch.enabled === 1,
        defaultAccount: ch.default_account || undefined,
        accounts,
      })
    }

    return result
  }

  /** 获取单个渠道配置 */
  getChannelConfig(channelId: string): { id: string; enabled: boolean; defaultAccount?: string; accounts: any[] } | null {
    const row = this.db.prepare('SELECT * FROM channel_config WHERE channel_id = ?').get(channelId) as any
    if (!row) return null

    const accounts = this.getChannelAccounts(channelId)
    return {
      id: row.channel_id,
      enabled: row.enabled === 1,
      defaultAccount: row.default_account || undefined,
      accounts,
    }
  }

  /** 获取渠道下的所有账户 */
  private getChannelAccounts(channelId: string): any[] {
    const rows = this.db.prepare('SELECT * FROM channel_account WHERE channel_id = ?').all(channelId) as any[]
    return rows.map(row => this.rowToChannelAccount(row))
  }

  /** 保存/更新渠道配置（含账户列表） */
  upsertChannelConfig(config: { id: string; enabled: boolean; defaultAccount?: string; accounts: any[] }): void {
    const now = Date.now()
    const existing = this.db.prepare('SELECT channel_id FROM channel_config WHERE channel_id = ?').get(config.id) as any

    if (existing) {
      this.db.prepare(`
        UPDATE channel_config
        SET enabled = ?, default_account = ?, updated_at = ?
        WHERE channel_id = ?
      `).run(config.enabled !== false ? 1 : 0, config.defaultAccount || '', now, config.id)
    } else {
      this.db.prepare(`
        INSERT INTO channel_config (channel_id, enabled, default_account, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(config.id, config.enabled !== false ? 1 : 0, config.defaultAccount || '', now, now)
    }

    // 同步账户：先删除旧的，再插入新的
    this.db.prepare('DELETE FROM channel_account WHERE channel_id = ?').run(config.id)
    for (const account of (config.accounts || [])) {
      this.insertChannelAccount(config.id, account, now)
    }
  }

  /** 插入单个账户 */
  private insertChannelAccount(channelId: string, account: any, now?: number): void {
    const ts = now || Date.now()
    // credentials 中的敏感字段加密后整体 JSON 序列化
    const encryptedCredentials = this.encryptCredentials(account.credentials ?? {})
    this.db.prepare(`
      INSERT INTO channel_account (
        account_id, channel_id, name, enabled, credentials,
        connection_mode, dm_policy, allow_from, group_policy,
        group_allow_from, groups, llm_config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      account.id,
      channelId,
      account.name || '',
      account.enabled !== false ? 1 : 0,
      encryptedCredentials,
      account.connectionMode || '',
      account.dmPolicy || '',
      JSON.stringify(account.allowFrom ?? []),
      account.groupPolicy || '',
      JSON.stringify(account.groupAllowFrom ?? []),
      JSON.stringify(account.groups ?? {}),
      JSON.stringify(account.llmConfig ?? {}),
      ts,
      ts,
    )
  }

  /** 删除渠道配置（含账户） */
  deleteChannelConfig(channelId: string): void {
    this.db.prepare('DELETE FROM channel_account WHERE channel_id = ?').run(channelId)
    this.db.prepare('DELETE FROM channel_config WHERE channel_id = ?').run(channelId)
  }

  /** 删除单个账户 */
  deleteChannelAccount(accountId: string): void {
    this.db.prepare('DELETE FROM channel_account WHERE account_id = ?').run(accountId)
  }

  /** 行转账户对象 */
  private rowToChannelAccount(row: any): any {
    let credentials: Record<string, string> = {}
    try {
      credentials = this.decryptCredentials(row.credentials)
    } catch { /* ignore */ }

    let allowFrom: string[] = []
    try { allowFrom = JSON.parse(row.allow_from) } catch { /* ignore */ }

    let groupAllowFrom: string[] = []
    try { groupAllowFrom = JSON.parse(row.group_allow_from) } catch { /* ignore */ }

    let groups: Record<string, any> = {}
    try { groups = JSON.parse(row.groups) } catch { /* ignore */ }

    let llmConfig: Record<string, any> = {}
    try { llmConfig = JSON.parse(row.llm_config) } catch { /* ignore */ }

    const account: any = {
      id: row.account_id,
      name: row.name,
      enabled: row.enabled === 1,
      credentials,
    }

    if (row.connection_mode) account.connectionMode = row.connection_mode
    if (row.dm_policy) account.dmPolicy = row.dm_policy
    if (allowFrom.length > 0) account.allowFrom = allowFrom
    if (row.group_policy) account.groupPolicy = row.group_policy
    if (groupAllowFrom.length > 0) account.groupAllowFrom = groupAllowFrom
    if (Object.keys(groups).length > 0) account.groups = groups
    if (Object.keys(llmConfig).length > 0) account.llmConfig = llmConfig

    return account
  }

  // ============================================
  // 凭证加密/解密
  // ============================================

  /** credentials 中的敏感值加密后整体 JSON 序列化 */
  private encryptCredentials(credentials: Record<string, string>): string {
    const encrypted: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials)) {
      if (value && typeof value === 'string') {
        encrypted[key] = encryptString(value)
      } else {
        encrypted[key] = value
      }
    }
    return JSON.stringify(encrypted)
  }

  /** 从加密的 JSON 字符串中解密 credentials */
  private decryptCredentials(raw: string): Record<string, string> {
    const parsed = JSON.parse(raw) as Record<string, string>
    const decrypted: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'string') {
        decrypted[key] = decryptString(value)
      } else {
        decrypted[key] = value
      }
    }
    return decrypted
  }
}
