/**
 * 本地自动化开关 — 读写
 *
 * 写穿 ModuleDataStore（自带 2s 防抖），启动时随 moduleDataStore.load() 一并恢复。
 * 这里只做"取值 / 改值 / 校验"，不含任何业务判断——开关怎么用由调用方决定。
 *
 * @module automation-settings/AutomationSettingsStore
 */

import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import {
  AUTOMATION_SETTINGS_LOG_PREFIX,
  AUTOMATION_SETTINGS_SCHEMA_VERSION,
  DEFAULT_AUTOMATION_SETTINGS,
  type AutomationSettings,
  type PersistedAutomationSettings,
} from './types'

export class AutomationSettingsStore {
  private current: AutomationSettings = { ...DEFAULT_AUTOMATION_SETTINGS }
  private loaded = false

  /**
   * 从存储恢复设置
   *
   * 幂等：重复调用直接返回。字段逐个校验，非法值回落到默认值，
   * 避免手工改坏配置文件后整个开关系统失效。
   */
  load(): void {
    if (this.loaded) return
    this.loaded = true

    try {
      const persisted = moduleDataStore.get<PersistedAutomationSettings>(
        STORE_KEYS.AUTOMATION_SETTINGS,
      )
      if (persisted && persisted.settings && typeof persisted.settings === 'object') {
        this.current = this.normalize(persisted.settings)
        logger.system.info(
          `${AUTOMATION_SETTINGS_LOG_PREFIX} 已恢复设置: triggers=${this.current.triggersEnabled} create=${this.current.autoCreateTask} execute=${this.current.autoExecuteTask}`,
        )
      }
    } catch (err) {
      logger.system.warn(
        `${AUTOMATION_SETTINGS_LOG_PREFIX} 设置恢复失败，使用默认值: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** 读取当前设置（返回副本，调用方改它不会影响内部状态） */
  get(): AutomationSettings {
    if (!this.loaded) this.load()
    return { ...this.current }
  }

  /**
   * 局部更新设置
   *
   * 只接受 boolean 字段；未知字段与非 boolean 值一律忽略，
   * 避免渲染层传错类型把开关置成奇怪的值。
   */
  update(patch: Partial<AutomationSettings>): AutomationSettings {
    if (!this.loaded) this.load()
    if (!patch || typeof patch !== 'object') return { ...this.current }

    const next: AutomationSettings = { ...this.current }
    let changed = false

    for (const key of Object.keys(DEFAULT_AUTOMATION_SETTINGS) as Array<keyof AutomationSettings>) {
      const value = patch[key]
      if (typeof value !== 'boolean') continue
      if (next[key] === value) continue
      next[key] = value
      changed = true
    }

    if (!changed) return { ...this.current }

    this.current = next
    this.persist()
    logger.system.info(
      `${AUTOMATION_SETTINGS_LOG_PREFIX} 设置已更新: triggers=${next.triggersEnabled} create=${next.autoCreateTask} execute=${next.autoExecuteTask}`,
    )
    return { ...this.current }
  }

  /** 恢复默认（全部关闭） */
  reset(): AutomationSettings {
    this.current = { ...DEFAULT_AUTOMATION_SETTINGS }
    this.persist()
    logger.system.info(`${AUTOMATION_SETTINGS_LOG_PREFIX} 设置已重置为默认（全关）`)
    return { ...this.current }
  }

  private normalize(raw: Partial<AutomationSettings>): AutomationSettings {
    const result: AutomationSettings = { ...DEFAULT_AUTOMATION_SETTINGS }
    for (const key of Object.keys(DEFAULT_AUTOMATION_SETTINGS) as Array<keyof AutomationSettings>) {
      const value = raw[key]
      if (typeof value === 'boolean') result[key] = value
    }
    return result
  }

  private persist(): void {
    try {
      const data: PersistedAutomationSettings = {
        version: AUTOMATION_SETTINGS_SCHEMA_VERSION,
        settings: this.current,
      }
      moduleDataStore.set(STORE_KEYS.AUTOMATION_SETTINGS, data)
    } catch (err) {
      logger.system.warn(
        `${AUTOMATION_SETTINGS_LOG_PREFIX} 设置持久化失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 全局设置单例 */
export const automationSettings = new AutomationSettingsStore()
