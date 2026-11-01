/**
 * 主动式助手权限闸门（阶段10 s10-05 新增）
 *
 * 职责：
 * - 持久化 ProactivePermissionConfig 到 ModuleDataStore（JSON 文件）
 * - 提供 check(proposal) 校验是否允许派发（注入到 ProactiveActionTrigger）
 * - 实现以下约束：
 *     1. enabled=false → 全局关闭，所有提案拦截
 *     2. level=off → 同上
 *     3. level 不允许当前 severity → 拦截
 *     4. categories[source]=false → 分类未开启，拦截
 *     5. quietHours 时段 → 仅 info 放行（其他降级为 info 或拦截）
 *     6. maxDisturbPerHour 超限 → 拦截非 info 提案
 *     7. critical 级必须 criticalWhitelist 包含 action.payload（否则降级为 high）
 *
 * 持久化策略：
 * - 使用 ModuleDataStore（防抖 2s 写盘）
 * - 启动时 load 已有配置，无则使用 DEFAULT_PERMISSION_CONFIG
 * - 配置变更立即生效（同步更新内存缓存）
 *
 * @module proactive/ProactivePermission
 */

import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import { proactiveDecisionEngine } from './ProactiveDecisionEngine'
import {
  type ProactivePermissionConfig,
  type ProactiveLevel,
  type ProactiveProposal,
  type ProactiveSeverity,
  type ProactiveSource,
  type ProposalFeedback,
  DEFAULT_PERMISSION_CONFIG,
  SEVERITY_WEIGHT,
  isSeverityAllowed,
  isInQuietHours,
} from './ProactiveInterface'
import { proactiveStore, type TrustLevel, type TrustState } from './ProactiveStore'

// ============================================================
// 类型定义
// ============================================================

/** 权限校验结果（与 ProactiveActionTrigger.PermissionChecker 兼容） */
export interface PermissionCheckResult {
  /** 是否允许派发 */
  allowed: boolean
  /** 拦截原因（allowed=false 时填） */
  reason?: 'disabled' | 'level_blocked' | 'category_disabled' | 'quiet_hours' | 'frequency_exceeded' | 'critical_not_whitelisted'
  /**
   * 降级后的 severity（allowed=true 时填）
   * - quietHours 时段下 medium/high/critical 降级为 info
   * - critical 不在白名单时降级为 high
   * - 冷启动期与信任等级不足时降级到对应上限
   * 未降级时等于 proposal.severity
   */
  effectiveSeverity?: ProactiveSeverity
  /** 是否由信任阶梯（含冷启动保护）降级而来 */
  degradedByTrust?: boolean
  /**
   * 是否需要在执行前再确认一次
   *
   * 仅 critical 且命中白名单时为 true：白名单是静态的，上下文是动态的，
   * 同一条命令上次对，这次环境变了就可能出错。
   */
  requiresConfirmation?: boolean
}

/** 频率限制滑动窗口（1 小时） */
interface FrequencyWindow {
  /** 时间戳列表（每次非 info 派发追加，自动清理 1h 前的记录） */
  timestamps: number[]
}

// ============================================================
// 常量
// ============================================================

/** 频率限制窗口大小（1 小时） */
const FREQUENCY_WINDOW_MS = 60 * 60 * 1000

/**
 * 冷启动保护期：前 N 次提案一律只提示
 *
 * 一次误执行造成的信任损失，远大于二十次漏报。
 */
const COLD_START_PROPOSALS = 20

/** 连续采纳达到此值可升级到 chat（允许主动对话） */
const ACCEPT_STREAK_FOR_CHAT = 5

/** 连续采纳达到此值且无拒绝记录，可进入 critical 白名单候选 */
const ACCEPT_STREAK_FOR_WHITELIST = 10

/** 累计拒绝达到此倍数即回退一级（每 2 次拒绝回退一次） */
const REJECT_ROLLBACK_EVERY = 2

/** 信任等级的升级顺序 */
const TRUST_LADDER: TrustLevel[] = ['observe', 'suggest', 'chat', 'whitelist']

/** ProactiveSource 到 categories 字段的映射（'fusion' 视为全局，总是允许） */
const SOURCE_CATEGORIES: Record<ProactiveSource, keyof ProactivePermissionConfig['categories'] | null> = {
  coding: 'coding',
  iot: 'iot',
  system: 'system',
  time: 'time',
  fusion: null, // 跨场景融合，不依赖单一分类
}

// ============================================================
// ProactivePermission 单例
// ============================================================

/**
 * 主动式助手权限闸门单例
 *
 * 使用方式：
 * ```ts
 * const permission = ProactivePermission.getInstance()
 * permission.load()  // 启动时加载配置
 *
 * // 注入到 ActionTrigger
 * proactiveActionTrigger.setPermissionChecker((proposal) => {
 *   const result = permission.check(proposal)
 *   return { allowed: result.allowed, reason: result.reason }
 * })
 *
 * // 更新配置（设置面板调用）
 * permission.updateConfig({ level: 'act' })
 *
 * // 配置变更触发决策引擎启动/停止
 * // - level=off 或 enabled=false → 停止决策引擎
 * // - 其他 → 启动决策引擎
 * ```
 */
export class ProactivePermission {
  private static instance: ProactivePermission | null = null

  /** 当前配置（内存缓存） */
  private config: ProactivePermissionConfig

  /** 频率限制滑动窗口 */
  private frequencyWindow: FrequencyWindow = { timestamps: [] }

  private constructor() {
    // 深拷贝默认配置，避免修改冻结对象
    this.config = structuredClone(DEFAULT_PERMISSION_CONFIG)
  }

  static getInstance(): ProactivePermission {
    if (!ProactivePermission.instance) {
      ProactivePermission.instance = new ProactivePermission()
    }
    return ProactivePermission.instance
  }

  // ============================================================
  // 配置加载与持久化
  // ============================================================

  /**
   * 从 ModuleDataStore 加载配置
   * 启动时调用，未找到配置时使用默认值
   */
  load(): void {
    try {
      const stored = moduleDataStore.get<ProactivePermissionConfig>(STORE_KEYS.PROACTIVE_PERMISSION)
      if (stored) {
        // 合并以补全新增字段（向前兼容）
        this.config = this.mergeWithDefaults(stored)
        logger.proactive?.info(
          `[ProactivePermission] 配置已加载: enabled=${this.config.enabled} level=${this.config.level}`,
        )
      } else {
        this.config = structuredClone(DEFAULT_PERMISSION_CONFIG)
        logger.proactive?.info('[ProactivePermission] 未找到已存配置，使用默认值')
      }
    } catch (err) {
      logger.proactive?.warn(
        `[ProactivePermission] 加载配置失败，使用默认值: ${err instanceof Error ? err.message : String(err)}`,
      )
      this.config = structuredClone(DEFAULT_PERMISSION_CONFIG)
    }
  }

  /**
   * 获取当前配置（只读视图）
   */
  getConfig(): Readonly<ProactivePermissionConfig> {
    return this.config
  }

  /**
   * 更新配置（部分更新）
   * 自动持久化到 ModuleDataStore + 触发决策引擎启动/停止
   * @param patch 待合并的配置片段
   * @returns 合并后的完整配置
   */
  updateConfig(patch: Partial<ProactivePermissionConfig>): ProactivePermissionConfig {
    this.config = this.mergeConfigs(this.config, patch)
    this.persist()

    logger.proactive?.info(
      `[ProactivePermission] 配置已更新: enabled=${this.config.enabled} level=${this.config.level}`,
    )

    // 根据新配置触发决策引擎启动/停止
    this.syncDecisionEngine()

    return this.config
  }

  /** 重置为默认配置 */
  resetConfig(): ProactivePermissionConfig {
    this.config = structuredClone(DEFAULT_PERMISSION_CONFIG)
    this.persist()
    this.syncDecisionEngine()
    logger.proactive?.info('[ProactivePermission] 配置已重置为默认值')
    return this.config
  }

  // ============================================================
  // 权限校验
  // ============================================================

  /**
   * 校验提案是否允许派发
   *
   * 校验顺序（短路求值，任一拦截立即返回）：
   * 1. enabled=false → disabled
   * 2. level=off → disabled
   * 3. severity 超出 level → level_blocked
   * 4. categories[source]=false → category_disabled
   * 5. 冷启动期或信任等级不足 → 降级到信任上限（allowed=true, degradedByTrust=true）
   * 6. quietHours 时段且 severity>info → 降级为 info（allowed=true, effectiveSeverity=info）
   * 7. maxDisturbPerHour 超限且 severity>info → frequency_exceeded
   * 8. critical 且 payload 不在白名单 → 降级为 high；
   *    命中白名单 → allowed=true 并置 requiresConfirmation（派发层插入撤销窗口）
   *
   * @param proposal 待校验的提案
   * @returns 校验结果
   */
  check(proposal: ProactiveProposal): PermissionCheckResult {
    // 1. 全局开关
    if (!this.config.enabled || this.config.level === 'off') {
      return { allowed: false, reason: 'disabled' }
    }

    // 2. 等级校验
    if (!isSeverityAllowed(proposal.severity, this.config.level as ProactiveLevel)) {
      return { allowed: false, reason: 'level_blocked' }
    }

    // 3. 分类校验（fusion 视为全局，跳过）
    const categoryKey = SOURCE_CATEGORIES[proposal.source]
    if (categoryKey !== null && !this.config.categories[categoryKey]) {
      return { allowed: false, reason: 'category_disabled' }
    }

    // 4. 冷启动保护与信任阶梯
    // 用户配置了 level=act 也只代表「允许」，不代表系统已被允许走到那一步：
    // 新装环境或采纳记录不足时，主动行为一律收敛到提示级。
    const trust = this.getTrustSnapshot()
    const severityCap = this.resolveSeverityCap(trust)
    if (SEVERITY_WEIGHT[proposal.severity] > SEVERITY_WEIGHT[severityCap]) {
      if (!isSeverityAllowed(severityCap, this.config.level as ProactiveLevel)) {
        return { allowed: false, reason: 'level_blocked' }
      }
      logger.proactive?.info(
        `[ProactivePermission] 信任降级: ${proposal.severity} → ${severityCap} ` +
        `(level=${trust.level}, proposals=${trust.proposalCount})`,
      )
      return { allowed: true, effectiveSeverity: severityCap, degradedByTrust: true }
    }

    // 5. 勿扰时段（仅 info 放行，其他降级为 info）
    if (isInQuietHours(new Date(), this.config.quietHours) && proposal.severity !== 'info') {
      logger.proactive?.info(
        `[ProactivePermission] 勿扰时段降级: ${proposal.severity} → info (proposal=${proposal.id})`,
      )
      return { allowed: true, effectiveSeverity: 'info' }
    }

    // 6. 频率限制（仅对非 info 提案计数）
    if (proposal.severity !== 'info') {
      this.cleanupFrequencyWindow()
      if (this.frequencyWindow.timestamps.length >= this.config.maxDisturbPerHour) {
        return { allowed: false, reason: 'frequency_exceeded' }
      }
    }

    // 7. critical 白名单校验
    if (proposal.severity === 'critical') {
      if (!this.config.criticalWhitelist.includes(proposal.action.payload)) {
        logger.proactive?.info(
          `[ProactivePermission] critical 不在白名单，降级为 high (proposal=${proposal.id})`,
        )
        // 降级为 high 前需校验 level 是否允许 high
        if (!isSeverityAllowed('high', this.config.level as ProactiveLevel)) {
          return { allowed: false, reason: 'level_blocked' }
        }
        return { allowed: true, effectiveSeverity: 'high' }
      }

      // 命中白名单不等于可以直接执行：静态白名单挡不住上下文漂移，
      // 交由派发层插入一次可撤销的确认窗口。
      return { allowed: true, effectiveSeverity: 'critical', requiresConfirmation: true }
    }

    return { allowed: true, effectiveSeverity: proposal.severity }
  }

  /**
   * 记录一次派发（频率限制使用）
   * 由 ProactiveActionTrigger 在派发成功后调用
   * @param severity 实际派发的 severity（降级后的值）
   */
  recordDispatch(severity: ProactiveSeverity): void {
    if (severity === 'info') return // info 不计入频率
    this.cleanupFrequencyWindow()
    this.frequencyWindow.timestamps.push(Date.now())

    // 冷启动保护按「真实派发过的提案」计数：只有走到用户面前的那次才算数，
    // 被拦截或降级为 info 的提案不消耗信任额度。
    const trust = this.getTrustSnapshot()
    trust.proposalCount += 1
    trust.updatedAt = Date.now()
    this.persistTrust(trust)
  }

  // ============================================================
  // 信任阶梯
  // ============================================================

  /** 读取当前信任状态（读失败按默认最低信任处理） */
  getTrustSnapshot(): TrustState {
    try {
      return proactiveStore.getTrustState('global')
    } catch (err) {
      logger.proactive?.warn(
        `[ProactivePermission] 读取信任状态失败，按最低信任处理: ${err instanceof Error ? err.message : String(err)}`,
      )
      return {
        scope: 'global',
        level: 'observe',
        acceptedStreak: 0,
        rejectedCount: 0,
        proposalCount: 0,
        updatedAt: 0,
      }
    }
  }

  /**
   * 记录一次用户反馈，按采纳数据逐级放权或回退
   *
   * 不按时间放权：装得多的一周过百次，装得少的一个月也过不了阈值，
   * 只有真实采纳行为才说明系统值得被信任。
   */
  recordFeedback(feedback: ProposalFeedback): TrustState {
    const trust = this.getTrustSnapshot()

    if (feedback === 'accepted') {
      trust.acceptedStreak += 1
      if (
        trust.acceptedStreak >= ACCEPT_STREAK_FOR_WHITELIST &&
        trust.rejectedCount === 0
      ) {
        trust.level = 'whitelist'
      } else if (trust.acceptedStreak >= ACCEPT_STREAK_FOR_CHAT) {
        trust.level = trust.level === 'whitelist' ? 'whitelist' : 'chat'
      } else if (trust.level === 'observe') {
        trust.level = 'suggest'
      }
    } else if (feedback === 'rejected' || feedback === 'ignored') {
      // ignored（被直接关掉）与 rejected 同罪：用户没有采纳，也没有留下可学习的信息
      trust.acceptedStreak = 0
      trust.rejectedCount += 1
      if (trust.rejectedCount % REJECT_ROLLBACK_EVERY === 0) {
        trust.level = this.rollbackLevel(trust.level)
      }
    }
    // later 表示「稍后再说」，既不算采纳也不算拒绝，不改变信任状态

    trust.updatedAt = Date.now()
    this.persistTrust(trust)
    return trust
  }

  /**
   * 主动回退一级信任
   *
   * 供每日校准使用：即时回退已由 recordFeedback 覆盖，这里兜的是
   * 「长期采纳率明显偏低但拒绝次数没到阈值」的情况 —— 用户不点拒绝、
   * 只是每次都忽略，同样说明这套提示对他没有价值。
   */
  downgradeTrust(reason: string): TrustState {
    const trust = this.getTrustSnapshot()
    const next = this.rollbackLevel(trust.level)
    if (next === trust.level) return trust

    trust.level = next
    trust.acceptedStreak = 0
    trust.updatedAt = Date.now()
    this.persistTrust(trust)
    logger.proactive?.info(
      `[ProactivePermission] 信任等级回退: ${next}（原因: ${reason}）`,
    )
    return trust
  }

  /** 当前信任等级允许的 severity 上限 */
  private resolveSeverityCap(trust: TrustState): ProactiveSeverity {
    if (trust.proposalCount < COLD_START_PROPOSALS) return 'medium'
    switch (trust.level) {
      case 'whitelist':
        return 'critical'
      case 'chat':
        return 'high'
      default:
        return 'medium'
    }
  }

  /** 回退一级信任（已在下限则保持） */
  private rollbackLevel(level: TrustLevel): TrustLevel {
    const index = TRUST_LADDER.indexOf(level)
    if (index <= 0) return TRUST_LADDER[0]
    return TRUST_LADDER[index - 1]
  }

  /** 持久化信任状态（失败仅记日志，不阻断校验流程） */
  private persistTrust(trust: TrustState): void {
    try {
      proactiveStore.saveTrustState(trust)
    } catch (err) {
      logger.proactive?.warn(
        `[ProactivePermission] 持久化信任状态失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 获取当前频率窗口状态（调试用）
   */
  getFrequencyStatus(): { count: number; maxPerHour: number; windowMs: number } {
    this.cleanupFrequencyWindow()
    return {
      count: this.frequencyWindow.timestamps.length,
      maxPerHour: this.config.maxDisturbPerHour,
      windowMs: FREQUENCY_WINDOW_MS,
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 清理频率窗口中过期的记录 */
  private cleanupFrequencyWindow(): void {
    const cutoff = Date.now() - FREQUENCY_WINDOW_MS
    this.frequencyWindow.timestamps = this.frequencyWindow.timestamps.filter((t) => t >= cutoff)
  }

  /**
   * 合并存储配置与默认配置（补全新增字段，向前兼容）
   */
  private mergeWithDefaults(stored: Partial<ProactivePermissionConfig>): ProactivePermissionConfig {
    return this.mergeConfigs(DEFAULT_PERMISSION_CONFIG, stored)
  }

  /**
   * 深度合并配置（base 为默认值，patch 覆盖）
   * 对 categories 和 quietHours 做字段级合并
   */
  private mergeConfigs(
    base: ProactivePermissionConfig,
    patch: Partial<ProactivePermissionConfig>,
  ): ProactivePermissionConfig {
    const result: ProactivePermissionConfig = {
      enabled: patch.enabled ?? base.enabled,
      level: patch.level ?? base.level,
      categories: {
        coding: patch.categories?.coding ?? base.categories.coding,
        iot: patch.categories?.iot ?? base.categories.iot,
        system: patch.categories?.system ?? base.categories.system,
        time: patch.categories?.time ?? base.categories.time,
      },
      quietHours: {
        enabled: patch.quietHours?.enabled ?? base.quietHours.enabled,
        start: patch.quietHours?.start ?? base.quietHours.start,
        end: patch.quietHours?.end ?? base.quietHours.end,
      },
      maxDisturbPerHour: patch.maxDisturbPerHour ?? base.maxDisturbPerHour,
      criticalWhitelist: patch.criticalWhitelist ?? [...base.criticalWhitelist],
    }
    return result
  }

  /** 持久化到 ModuleDataStore */
  private persist(): void {
    try {
      moduleDataStore.set(STORE_KEYS.PROACTIVE_PERMISSION, this.config)
    } catch (err) {
      logger.proactive?.error(
        `[ProactivePermission] 持久化配置失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 根据当前配置同步决策引擎的运行状态
   * - enabled=false 或 level=off → 停止决策引擎
   * - 否则 → 启动决策引擎（如未启动）
   */
  private syncDecisionEngine(): void {
    const shouldRun = this.config.enabled && this.config.level !== 'off'
    const isRunning = proactiveDecisionEngine.isRunning()

    if (shouldRun && !isRunning) {
      try {
        proactiveDecisionEngine.start()
        logger.proactive?.info('[ProactivePermission] 决策引擎已启动（配置启用）')
      } catch (err) {
        logger.proactive?.error(
          `[ProactivePermission] 启动决策引擎失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else if (!shouldRun && isRunning) {
      try {
        proactiveDecisionEngine.stop()
        logger.proactive?.info('[ProactivePermission] 决策引擎已停止（配置关闭）')
      } catch (err) {
        logger.proactive?.error(
          `[ProactivePermission] 停止决策引擎失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}

// ============================================================
// 导出单例
// ============================================================

export const proactivePermission = ProactivePermission.getInstance()
