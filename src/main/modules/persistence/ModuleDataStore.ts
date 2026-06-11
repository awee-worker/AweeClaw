/**
 * 模块数据持久化存储
 *
 * 为 Agent bindings、Cron tasks、Session contexts 等提供持久化能力。
 * 基于 JSON 文件存储，与项目 ChannelConfigStore 方案一致。
 *
 * 设计原则：
 * - JSON 文件为唯一真相来源
 * - 内存缓存加速读取
 * - 启动时加载，运行时写穿（write-through）
 * - 防抖写入，避免高频 IO
 *
 * @module persistence/ModuleDataStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 存储键定义
// ============================================

export const STORE_KEYS = {
  AGENT_BINDINGS: 'agent_bindings',
  AGENT_WORKSPACES: 'agent_workspaces',
  AGENT_AUTH_CONTEXTS: 'agent_auth_contexts',
  AGENT_DM_PAIRINGS: 'agent_dm_pairings',
  CRON_TASKS: 'cron_tasks',
  SESSION_CONTEXTS: 'session_contexts',
  SECURITY_APPROVAL_CONFIG: 'security_approval_config',
  SECURITY_SANDBOX_CONFIG: 'security_sandbox_config',
  SECURITY_AGENT_APPROVAL_OVERRIDES: 'security_agent_approval_overrides',
  SECURITY_AGENT_SANDBOX_OVERRIDES: 'security_agent_sandbox_overrides',
} as const

// ============================================
// 模块数据存储
// ============================================

const DATA_DIR_NAME = 'module-data'
const SAVE_DEBOUNCE_MS = 2000

class ModuleDataStore {
  private dataDir: string
  private memoryCache = new Map<string, unknown>()
  private loaded = false
  /** 防抖写入定时器 */
  private dirtyKeys = new Set<string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const userDataPath = app.getPath('userData')
    this.dataDir = path.join(userDataPath, DATA_DIR_NAME)
  }

  /**
   * 启动时加载所有数据到内存缓存
   */
  load(): void {
    if (this.loaded) return

    // 确保数据目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }

    try {
      const files = fs.readdirSync(this.dataDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const key = file.slice(0, -5) // 去掉 .json
        try {
          const content = fs.readFileSync(path.join(this.dataDir, file), 'utf-8')
          this.memoryCache.set(key, JSON.parse(content))
        } catch (err) {
          logger.system.warn(`[ModuleDataStore] Failed to load ${key}: ${err}`)
        }
      }
      this.loaded = true
      logger.system.info(`[ModuleDataStore] Loaded ${this.memoryCache.size} entries from ${this.dataDir}`)
    } catch (err) {
      logger.system.error(`[ModuleDataStore] Failed to load: ${err}`)
    }
  }

  /**
   * 刷新所有脏数据到磁盘
   */
  flush(): void {
    this.saveNow()
  }

  /**
   * 获取数据
   */
  get<T = unknown>(key: string): T | undefined {
    return this.memoryCache.get(key) as T | undefined
  }

  /**
   * 设置数据（写穿：更新内存 + 标记脏数据）
   */
  set<T = unknown>(key: string, value: T): void {
    this.memoryCache.set(key, value)
    this.markDirty(key)
  }

  /**
   * 删除数据
   */
  delete(key: string): boolean {
    const existed = this.memoryCache.has(key)
    this.memoryCache.delete(key)

    // 删除文件
    const filePath = this.getFilePath(key)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (err) {
      logger.system.warn(`[ModuleDataStore] Failed to delete file for ${key}: ${err}`)
    }

    return existed
  }

  /**
   * 检查数据是否存在
   */
  has(key: string): boolean {
    return this.memoryCache.has(key)
  }

  // ============================================
  // 私有方法
  // ============================================

  private getFilePath(key: string): string {
    return path.join(this.dataDir, `${key}.json`)
  }

  private markDirty(key: string): void {
    this.dirtyKeys.add(key)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS)
  }

  private saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    if (this.dirtyKeys.size === 0) return

    // 确保数据目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }

    for (const key of this.dirtyKeys) {
      const value = this.memoryCache.get(key)
      if (value === undefined) continue

      try {
        const filePath = this.getFilePath(key)
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
      } catch (err) {
        logger.system.error(`[ModuleDataStore] Failed to save ${key}: ${err}`)
      }
    }

    const count = this.dirtyKeys.size
    this.dirtyKeys.clear()
    logger.system.debug(`[ModuleDataStore] Saved ${count} entries to disk`)
  }
}

/** 全局模块数据存储实例 */
export const moduleDataStore = new ModuleDataStore()
