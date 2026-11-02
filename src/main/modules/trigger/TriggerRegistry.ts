/**
 * 事件触发器注册表
 *
 * 职责：
 * 1. 事件源注册与生命周期管理（源 push 事件，不轮询）
 * 2. 第一道漏斗：规则匹配（sourceType / eventTypes / include / ignore）
 * 3. 冷却去重：同 dedupKey 在冷却窗口内只命中一次
 * 4. 第二道漏斗：语义判定（可注入，未注入时全部放行）
 * 5. 命中后通过 EventEmitter 发射 'hit'，由订阅者决定落成任务还是提案
 *
 * 设计约束：
 * - 单个事件源或规则异常不得影响其他源与规则（逐条隔离）
 * - 冷却表持久化，进程重启后不重复告警同一事件
 * - 规则与冷却表均写穿 ModuleDataStore，重启可恢复
 *
 * @module trigger/TriggerRegistry
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import {
  DEFAULT_TRIGGER_CONFIG,
  TRIGGER_LOG_PREFIX,
  type SemanticChecker,
  type TriggerEvent,
  type TriggerHit,
  type TriggerRule,
  type TriggerSource,
  type TriggerStats,
} from './types'

/** 冷却表条目：dedupKey → 最近命中时间戳 */
type CooldownMap = Record<string, number>

/** 规则持久化结构 */
interface PersistedRules {
  version: number
  rules: TriggerRule[]
}

const RULES_SCHEMA_VERSION = 1

/**
 * 将 glob 模式转为正则
 *
 * 支持：
 * - `*`  匹配除路径分隔符外的任意字符
 * - `**` 匹配任意字符（含路径分隔符）
 * - `?`  匹配单个非分隔符字符
 * - 其余字符按字面量转义
 */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/\\\\]*'
      }
    } else if (ch === '?') {
      out += '[^/\\\\]'
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/** 统一路径分隔符，避免 Windows 反斜杠与 glob 的 `/` 不一致 */
function normalizeSubject(subject: string): string {
  return subject.replace(/\\/g, '/')
}

/** subject 是否命中任一模式（模式本身也按 `/` 归一） */
export function matchesAnyPattern(subject: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const normalized = normalizeSubject(subject)
  for (const pattern of patterns) {
    if (!pattern) continue
    const normalizedPattern = normalizeSubject(pattern)
    // 纯前缀写法（以 / 结尾或以 . 开头且不含通配符）走 startsWith，更快也更直观
    if (!/[*?]/.test(normalizedPattern)) {
      if (normalized === normalizedPattern || normalized.startsWith(normalizedPattern)) {
        return true
      }
      continue
    }
    try {
      if (globToRegExp(normalizedPattern).test(normalized)) return true
    } catch {
      // 非法模式忽略，不影响其他模式
    }
  }
  return false
}

export class TriggerRegistry extends EventEmitter {
  private readonly sources = new Map<string, TriggerSource>()
  private readonly rules = new Map<string, TriggerRule>()
  private readonly cooldowns: CooldownMap = {}

  private semanticChecker: SemanticChecker | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private loaded = false

  private stats: TriggerStats = {
    ruleCount: 0,
    sourceCount: 0,
    receivedEvents: 0,
    passedRules: 0,
    dispatchedHits: 0,
    suppressedByCooldown: 0,
    rejectedBySemantic: 0,
    unaccountedDrops: 0,
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 启动注册表：加载持久化规则 → 启动所有已注册源 → 开启冷却表清理
   *
   * 幂等：重复调用安全。
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.system.debug(`${TRIGGER_LOG_PREFIX} 已启动，忽略重复 start`)
      return
    }
    this.started = true
    this.loadFromStore()

    for (const source of this.sources.values()) {
      await this.startSource(source)
    }

    this.cleanupTimer = setInterval(
      () => this.cleanupCooldowns(),
      DEFAULT_TRIGGER_CONFIG.cooldownCleanupIntervalMs,
    )

    this.syncStats()
    logger.system.info(
      `${TRIGGER_LOG_PREFIX} 触发器已启动（${this.sources.size} 个源 / ${this.rules.size} 条规则）`,
    )
    this.emit('started')
  }

  /** 停止注册表：停止所有源并释放定时器 */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    for (const source of this.sources.values()) {
      await this.stopSource(source)
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    logger.system.info(`${TRIGGER_LOG_PREFIX} 触发器已停止`)
    this.emit('stopped')
  }

  isRunning(): boolean {
    return this.started
  }

  // ============================================================
  // 事件源管理
  // ============================================================

  /** 注册事件源；若注册表已启动则立即启动该源 */
  async registerSource(source: TriggerSource): Promise<void> {
    if (this.sources.has(source.id)) {
      logger.system.debug(`${TRIGGER_LOG_PREFIX} 事件源已存在，忽略重复注册: ${source.id}`)
      return
    }
    this.sources.set(source.id, source)
    this.syncStats()
    logger.system.info(`${TRIGGER_LOG_PREFIX} 已注册事件源: ${source.id} (${source.type})`)

    if (this.started) {
      await this.startSource(source)
    }
    this.emit('source-registered', { id: source.id, type: source.type })
  }

  /** 注销事件源（先停止再移除） */
  async unregisterSource(sourceId: string): Promise<boolean> {
    const source = this.sources.get(sourceId)
    if (!source) return false
    await this.stopSource(source)
    this.sources.delete(sourceId)
    this.syncStats()
    logger.system.info(`${TRIGGER_LOG_PREFIX} 已注销事件源: ${sourceId}`)
    return true
  }

  listSources(): Array<{ id: string; type: string }> {
    return Array.from(this.sources.values()).map((s) => ({ id: s.id, type: s.type }))
  }

  // ============================================================
  // 规则管理
  // ============================================================

  /** 新增或覆盖规则 */
  upsertRule(rule: TriggerRule): TriggerRule {
    const normalized: TriggerRule = {
      ...rule,
      include: rule.include ?? [],
      ignore: rule.ignore ?? [],
      eventTypes: rule.eventTypes ?? [],
      cooldownMs:
        typeof rule.cooldownMs === 'number' && rule.cooldownMs >= 0
          ? rule.cooldownMs
          : DEFAULT_TRIGGER_CONFIG.defaultCooldownMs,
      createdAt: rule.createdAt || Date.now(),
    }
    this.rules.set(normalized.id, normalized)
    this.persistRules()
    this.syncStats()
    logger.system.info(`${TRIGGER_LOG_PREFIX} 规则已保存: ${normalized.name} (${normalized.id})`)
    this.emit('rule-updated', normalized)
    return normalized
  }

  removeRule(ruleId: string): boolean {
    const existed = this.rules.delete(ruleId)
    if (!existed) return false
    this.persistRules()
    this.syncStats()
    logger.system.info(`${TRIGGER_LOG_PREFIX} 规则已删除: ${ruleId}`)
    this.emit('rule-removed', ruleId)
    return true
  }

  getRule(ruleId: string): TriggerRule | undefined {
    return this.rules.get(ruleId)
  }

  listRules(): TriggerRule[] {
    return Array.from(this.rules.values())
  }

  setRuleEnabled(ruleId: string, enabled: boolean): TriggerRule | null {
    const rule = this.rules.get(ruleId)
    if (!rule) return null
    return this.upsertRule({ ...rule, enabled })
  }

  // ============================================================
  // 语义漏斗注入
  // ============================================================

  /**
   * 注入语义判定器（第二道漏斗）
   * 传 null 清除，恢复全部放行。
   */
  setSemanticChecker(checker: SemanticChecker | null): void {
    this.semanticChecker = checker
    logger.system.info(
      `${TRIGGER_LOG_PREFIX} 语义判定器${checker ? '已注入' : '已清除'}`,
    )
  }

  // ============================================================
  // 事件入口
  // ============================================================

  /**
   * 接收事件源上抛的原始事件，走两道漏斗后派发命中
   *
   * 逐规则隔离：单条规则异常不影响其他规则。
   */
  async handleEvent(event: TriggerEvent): Promise<TriggerHit[]> {
    this.stats.receivedEvents++

    const hits: TriggerHit[] = []

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue
      if (rule.sourceType !== event.sourceType) continue
      if (rule.eventTypes.length > 0 && !rule.eventTypes.includes(event.eventType)) continue

      // 第一道漏斗：include / ignore
      if (rule.include.length > 0 && !matchesAnyPattern(event.subject, rule.include)) continue
      if (rule.ignore.length > 0 && matchesAnyPattern(event.subject, rule.ignore)) continue

      this.stats.passedRules++

      const dedupKey = `${rule.id}:${normalizeSubject(event.subject)}`
      if (this.isCoolingDown(dedupKey, rule.cooldownMs)) {
        this.stats.suppressedByCooldown++
        continue
      }

      const hit: TriggerHit = {
        ruleId: rule.id,
        ruleName: rule.name,
        event,
        dedupKey,
        action: rule.action,
        timestamp: Date.now(),
      }

      // 第二道漏斗：语义判定
      if (this.semanticChecker) {
        try {
          const verdict = await this.semanticChecker(hit)
          if (!verdict.accept) {
            this.stats.rejectedBySemantic++
            logger.system.debug(
              `${TRIGGER_LOG_PREFIX} 语义判定拒绝: ${rule.name} subject=${event.subject} reason=${verdict.reason ?? 'unspecified'}`,
            )
            continue
          }
        } catch (err) {
          // 判定器异常不能吞掉事件，按放行处理但留痕
          logger.system.warn(
            `${TRIGGER_LOG_PREFIX} 语义判定异常，按放行处理: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      // 通过两道漏斗后才记录冷却，避免被拒绝的事件占住冷却窗口
      this.markCooldown(dedupKey)
      hits.push(hit)
      this.stats.dispatchedHits++
    }

    for (const hit of hits) {
      this.emit('hit', hit)
    }

    if (hits.length > 0) {
      this.syncStats()
    }
    return hits
  }

  getStats(): TriggerStats {
    this.syncStats()
    return { ...this.stats }
  }

  // ============================================================
  // 内部实现
  // ============================================================

  private async startSource(source: TriggerSource): Promise<void> {
    try {
      await source.start((event) => {
        this.handleEvent(event).catch((err) => {
          logger.system.error(
            `${TRIGGER_LOG_PREFIX} 事件处理异常 (source=${source.id}): ${err instanceof Error ? err.message : String(err)}`,
          )
        })
      })
      logger.system.info(`${TRIGGER_LOG_PREFIX} 事件源已启动: ${source.id}`)
    } catch (err) {
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 事件源启动失败 (${source.id}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async stopSource(source: TriggerSource): Promise<void> {
    try {
      await source.stop()
    } catch (err) {
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 事件源停止失败 (${source.id}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private isCoolingDown(dedupKey: string, cooldownMs: number): boolean {
    if (cooldownMs <= 0) return false
    const last = this.cooldowns[dedupKey]
    if (!last) return false
    return Date.now() - last < cooldownMs
  }

  private markCooldown(dedupKey: string): void {
    this.cooldowns[dedupKey] = Date.now()
    this.persistCooldowns()
  }

  /** 清理过期的冷却条目（超过默认窗口 10 倍即视为过期） */
  private cleanupCooldowns(): void {
    const threshold = Date.now() - DEFAULT_TRIGGER_CONFIG.defaultCooldownMs * 10
    let removed = 0
    for (const [key, ts] of Object.entries(this.cooldowns)) {
      if (ts < threshold) {
        delete this.cooldowns[key]
        removed++
      }
    }
    if (removed > 0) {
      this.persistCooldowns()
      logger.system.debug(`${TRIGGER_LOG_PREFIX} 清理过期冷却条目 ${removed} 条`)
    }
  }

  private syncStats(): void {
    this.stats.ruleCount = this.rules.size
    this.stats.sourceCount = this.sources.size
    // 成对计数校验：通过规则漏斗的次数必须等于三个出口之和。
    // 这里重算而非累加，保证派生值不会因多次 sync 而漂移。
    this.stats.unaccountedDrops =
      this.stats.passedRules -
      this.stats.dispatchedHits -
      this.stats.suppressedByCooldown -
      this.stats.rejectedBySemantic
  }

  // ============================================================
  // 持久化
  // ============================================================

  private loadFromStore(): void {
    if (this.loaded) return
    this.loaded = true

    try {
      const persisted = moduleDataStore.get<PersistedRules>(STORE_KEYS.TRIGGER_RULES)
      if (persisted && Array.isArray(persisted.rules)) {
        for (const rule of persisted.rules) {
          if (!rule || !rule.id) continue
          this.rules.set(rule.id, {
            ...rule,
            include: rule.include ?? [],
            ignore: rule.ignore ?? [],
            eventTypes: rule.eventTypes ?? [],
          })
        }
        logger.system.info(`${TRIGGER_LOG_PREFIX} 已从存储恢复 ${this.rules.size} 条规则`)
      }

      const cooldowns = moduleDataStore.get<CooldownMap>(STORE_KEYS.TRIGGER_COOLDOWN)
      if (cooldowns && typeof cooldowns === 'object') {
        Object.assign(this.cooldowns, cooldowns)
      }
    } catch (err) {
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 规则恢复失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private persistRules(): void {
    try {
      const data: PersistedRules = {
        version: RULES_SCHEMA_VERSION,
        rules: Array.from(this.rules.values()),
      }
      moduleDataStore.set(STORE_KEYS.TRIGGER_RULES, data)
    } catch (err) {
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 规则持久化失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private persistCooldowns(): void {
    try {
      moduleDataStore.set(STORE_KEYS.TRIGGER_COOLDOWN, this.cooldowns)
    } catch (err) {
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 冷却表持久化失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 全局触发器注册表单例 */
export const triggerRegistry = new TriggerRegistry()
