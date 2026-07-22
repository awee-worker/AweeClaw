/**
 * 主动式助手自适应学习器（阶段10 s10-10 新增）
 *
 * 职责：
 * - 每日 04:00 由 CronScheduler 触发，统计近 7 天提案采纳率
 * - 根据采纳率自适应调整 ProactivePermission 的频率上限（maxDisturbPerHour）
 * - 持久化最近一次校准快照到 ModuleDataStore（PROACTIVE_LEARNER_STATS）
 * - 启动时恢复上次校准快照（仅日志展示，配置已持久化在 ProactivePermission）
 *
 * 设计原则：
 * - 不直接修改 ProactiveDecisionEngine（保持决策引擎无状态）
 * - 通过 ProactivePermission.updateConfig 间接影响派发频率
 * - 样本不足（total < MIN_SAMPLE_SIZE）时不调整，避免冷启动误调
 * - 单调有界调整：每次 ±1，下限 1，上限 6，避免抖动
 *
 * 数据流：
 *   ProactiveStore.proposals + feedback
 *     → getAdoptionStats(7d)
 *     → computeNewMaxDisturb(adoptionRate, current)
 *     → ProactivePermission.updateConfig({ maxDisturbPerHour })
 *     → ModuleDataStore.set(PROACTIVE_LEARNER_STATS, snapshot)
 *
 * @module proactive/ProactiveLearner
 */

import { logger } from '@shared/toolkit/LogEngine'
import { proactiveStore } from './ProactiveStore'
import { proactivePermission } from './ProactivePermission'
import type { AdoptionStats } from './ProactiveInterface'
import { moduleDataStore } from '../persistence/ModuleDataStore'
import { STORE_KEYS } from '../persistence/ModuleDataStore'

/**
 * CronScheduler 实例类型
 *
 * CronScheduler 类未导出，通过 `typeof import(...)` 推导其单例实例的类型。
 * 仅用于类型注解，不引入运行时引用。
 */
type CronSchedulerInstance = typeof import('../automation/CronScheduler')['cronScheduler']

// ============================================================
// 常量
// ============================================================

/** 校准窗口：近 7 天（毫秒） */
const CALIBRATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** 最小样本数：不足则跳过调整 */
const MIN_SAMPLE_SIZE = 10

/** maxDisturbPerHour 调整下限 */
const MIN_DISTURB_PER_HOUR = 1

/** maxDisturbPerHour 调整上限 */
const MAX_DISTURB_PER_HOUR = 6

/** 高采纳率阈值（≥ 此值则放宽频率） */
const HIGH_ADOPTION_RATE = 0.6

/** 低采纳率阈值（< 此值则收紧频率） */
const LOW_ADOPTION_RATE = 0.3

/** Cron 任务名称（用于去重与事件过滤） */
const CRON_TASK_NAME = 'proactive-learner-daily-calibration'

/** Cron 表达式：每日 04:00 */
const CRON_EXPRESSION = '0 4 * * *'

/** Cron 任务指令（内部标记，不发送给 Agent） */
const CRON_COMMAND = '__proactive_learner_calibrate__'

// ============================================================
// 类型定义
// ============================================================

/**
 * 单次校准快照
 *
 * 持久化到 ModuleDataStore，用于启动时恢复与日志展示。
 */
export interface LearnerCalibrationSnapshot {
  /** 校准时间戳（ms） */
  calibratedAt: number
  /** 统计窗口起始（ms） */
  windowStart: number
  /** 统计窗口结束（ms） */
  windowEnd: number
  /** 采纳率统计快照 */
  stats: AdoptionStats
  /** 本次应用的调整 */
  adjustments: {
    /** maxDisturbPerHour 的调整记录 */
    maxDisturbPerHour: {
      from: number
      to: number
      reason: string
    }
    /** 因低采纳被关闭的分类（预留，当前实现未启用） */
    categoriesDisabled?: string[]
  }
  /** 是否跳过校准（样本不足等原因） */
  skipped: boolean
  /** 跳过原因（skipped=true 时有值） */
  skipReason?: string
}

// ============================================================
// ProactiveLearner 单例
// ============================================================

/**
 * 主动式助手自适应学习器
 *
 * 使用方式：
 * ```ts
 * const learner = ProactiveLearner.getInstance()
 * await learner.initialize()   // 注册 cron 任务 + 恢复快照
 * await learner.calibrate()    // 手动触发一次校准（测试用）
 * learner.dispose()             // 注销资源
 * ```
 */
export class ProactiveLearner {
  private static instance: ProactiveLearner | null = null

  /** 是否已初始化 */
  private initialized = false

  /** 已注册的 Cron 任务 ID（用于 dispose 时注销） */
  private registeredTaskId: string | null = null

  /** Cron 任务执行事件取消订阅函数 */
  private unsubscribeCron: (() => void) | null = null

  /** CronScheduler 实例引用（初始化时缓存，避免 dispose 时动态 import） */
  private cronScheduler: CronSchedulerInstance | null = null

  /** 上次校准快照（内存缓存） */
  private lastSnapshot: LearnerCalibrationSnapshot | null = null

  private constructor() {}

  /** 获取单例 */
  static getInstance(): ProactiveLearner {
    if (!ProactiveLearner.instance) {
      ProactiveLearner.instance = new ProactiveLearner()
    }
    return ProactiveLearner.instance
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 初始化学习器
   *
   * 流程：
   * 1. 加载上次校准快照（仅日志展示）
   * 2. 注册每日 04:00 Cron 任务（带去重检查）
   * 3. 订阅 Cron 'task-execute' 事件，按 taskName 过滤触发 calibrate
   *
   * 必须在 proactiveStore.initialize() 完成后调用，
   * 否则首次校准会因 SQLite 未就绪而失败。
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.proactive?.warn('[ProactiveLearner] 已初始化，跳过重复调用')
      return
    }

    try {
      // 1. 加载上次校准快照
      this.loadLastSnapshot()

      // 2. 注册 Cron 任务（带去重）
      await this.registerCalibrationTask()

      // 3. 订阅 Cron 任务执行事件
      this.subscribeCronExecution()

      this.initialized = true
      logger.proactive?.info('[ProactiveLearner] 初始化完成（每日 04:00 自动校准）')
    } catch (err) {
      logger.proactive?.error('[ProactiveLearner] 初始化失败:', err)
      // 初始化失败不抛出，仅记录日志，避免阻塞主进程启动
    }
  }

  /**
   * 释放资源
   *
   * 在应用退出或模块卸载时调用。
   */
  dispose(): void {
    if (this.unsubscribeCron) {
      try {
        this.unsubscribeCron()
      } catch (e) {
        logger.proactive?.warn('[ProactiveLearner] 取消 Cron 订阅失败:', e)
      }
      this.unsubscribeCron = null
    }

    // 注销 Cron 任务
    if (this.registeredTaskId && this.cronScheduler) {
      try {
        this.cronScheduler.unregister(this.registeredTaskId)
        logger.proactive?.info('[ProactiveLearner] 已注销 Cron 任务')
      } catch (e) {
        logger.proactive?.warn('[ProactiveLearner] 注销 Cron 任务失败:', e)
      }
      this.registeredTaskId = null
    }

    this.cronScheduler = null
    this.initialized = false
  }

  // ============================================================
  // 校准核心
  // ============================================================

  /**
   * 执行一次校准
   *
   * 流程：
   * 1. 查询近 7 天采纳率统计
   * 2. 样本不足则跳过（记录 skipped 快照）
   * 3. 根据采纳率计算新的 maxDisturbPerHour
   * 4. 通过 ProactivePermission.updateConfig 应用
   * 5. 持久化校准快照
   *
   * 可手动调用（测试用），也可由 Cron 任务触发。
   *
   * @returns 校准快照
   */
  async calibrate(): Promise<LearnerCalibrationSnapshot> {
    const now = Date.now()
    const windowStart = now - CALIBRATION_WINDOW_MS

    try {
      // 1. 查询近 7 天统计
      const stats = proactiveStore.getAdoptionStats(windowStart, now)

      // 2. 样本不足则跳过
      if (stats.total < MIN_SAMPLE_SIZE) {
        const skipReason = `样本不足（total=${stats.total} < ${MIN_SAMPLE_SIZE}），跳过本次校准`
        logger.proactive?.info(`[ProactiveLearner] ${skipReason}`)

        const snapshot: LearnerCalibrationSnapshot = {
          calibratedAt: now,
          windowStart,
          windowEnd: now,
          stats,
          adjustments: {
            maxDisturbPerHour: {
              from: proactivePermission.getConfig().maxDisturbPerHour,
              to: proactivePermission.getConfig().maxDisturbPerHour,
              reason: skipReason,
            },
          },
          skipped: true,
          skipReason,
        }
        this.saveSnapshot(snapshot)
        return snapshot
      }

      // 3. 计算新的 maxDisturbPerHour
      const currentConfig = proactivePermission.getConfig()
      const currentMax = currentConfig.maxDisturbPerHour
      const newMax = this.computeNewMaxDisturb(stats.adoptionRate, currentMax)
      const reason = this.buildAdjustReason(stats.adoptionRate, currentMax, newMax)

      // 4. 应用配置（仅当变化时才更新，减少不必要的持久化）
      if (newMax !== currentMax) {
        proactivePermission.updateConfig({ maxDisturbPerHour: newMax })
        logger.proactive?.info(
          `[ProactiveLearner] 频率上限调整: ${currentMax} → ${newMax}/h（采纳率=${(stats.adoptionRate * 100).toFixed(1)}%，原因: ${reason}）`,
        )
      } else {
        logger.proactive?.info(
          `[ProactiveLearner] 频率上限保持 ${currentMax}/h（采纳率=${(stats.adoptionRate * 100).toFixed(1)}%，原因: ${reason}）`,
        )
      }

      // 5. 持久化快照
      const snapshot: LearnerCalibrationSnapshot = {
        calibratedAt: now,
        windowStart,
        windowEnd: now,
        stats,
        adjustments: {
          maxDisturbPerHour: {
            from: currentMax,
            to: newMax,
            reason,
          },
        },
        skipped: false,
      }
      this.saveSnapshot(snapshot)

      return snapshot
    } catch (err) {
      logger.proactive?.error('[ProactiveLearner] 校准失败:', err)
      throw err
    }
  }

  /** 获取上次校准快照（内存缓存） */
  getLastSnapshot(): LearnerCalibrationSnapshot | null {
    return this.lastSnapshot
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 根据采纳率计算新的 maxDisturbPerHour
   *
   * 策略：
   * - adoptionRate ≥ 0.6（高采纳）：放宽频率 +1，上限 6
   * - adoptionRate < 0.3（低采纳）：收紧频率 -1，下限 1
   * - 0.3 ≤ adoptionRate < 0.6（中等）：保持不变
   *
   * @param rate 采纳率 [0, 1]
   * @param current 当前 maxDisturbPerHour
   */
  private computeNewMaxDisturb(rate: number, current: number): number {
    if (rate >= HIGH_ADOPTION_RATE) {
      return Math.min(current + 1, MAX_DISTURB_PER_HOUR)
    }
    if (rate < LOW_ADOPTION_RATE) {
      return Math.max(current - 1, MIN_DISTURB_PER_HOUR)
    }
    return current
  }

  /** 构建调整原因描述 */
  private buildAdjustReason(
    rate: number,
    from: number,
    to: number,
  ): string {
    if (to === from) {
      if (rate >= HIGH_ADOPTION_RATE) {
        return `采纳率 ${(rate * 100).toFixed(1)}% ≥ ${HIGH_ADOPTION_RATE * 100}%，但已达上限 ${MAX_DISTURB_PER_HOUR}/h`
      }
      if (rate < LOW_ADOPTION_RATE) {
        return `采纳率 ${(rate * 100).toFixed(1)}% < ${LOW_ADOPTION_RATE * 100}%，但已达下限 ${MIN_DISTURB_PER_HOUR}/h`
      }
      return `采纳率 ${(rate * 100).toFixed(1)}% 处于中性区间 [${LOW_ADOPTION_RATE * 100}%, ${HIGH_ADOPTION_RATE * 100}%)，保持不变`
    }
    if (to > from) {
      return `采纳率 ${(rate * 100).toFixed(1)}% ≥ ${HIGH_ADOPTION_RATE * 100}%，放宽频率上限`
    }
    return `采纳率 ${(rate * 100).toFixed(1)}% < ${LOW_ADOPTION_RATE * 100}%，收紧频率上限`
  }

  /**
   * 加载上次校准快照
   *
   * 仅用于日志展示与内存缓存。配置本身已由 ProactivePermission 持久化，
   * 无需在此处恢复。
   */
  private loadLastSnapshot(): void {
    try {
      const saved = moduleDataStore.get<LearnerCalibrationSnapshot>(
        STORE_KEYS.PROACTIVE_LEARNER_STATS,
      )
      if (saved) {
        this.lastSnapshot = saved
        logger.proactive?.info(
          `[ProactiveLearner] 上次校准: ${new Date(saved.calibratedAt).toISOString()}` +
            `，采纳率=${(saved.stats.adoptionRate * 100).toFixed(1)}%` +
            `，maxDisturbPerHour=${saved.adjustments.maxDisturbPerHour.from}→${saved.adjustments.maxDisturbPerHour.to}` +
            `${saved.skipped ? '（已跳过）' : ''}`,
        )
      } else {
        logger.proactive?.info('[ProactiveLearner] 无历史校准记录，等待首次校准')
      }
    } catch (err) {
      logger.proactive?.warn('[ProactiveLearner] 加载校准快照失败:', err)
    }
  }

  /** 持久化校准快照到 ModuleDataStore */
  private saveSnapshot(snapshot: LearnerCalibrationSnapshot): void {
    try {
      moduleDataStore.set(STORE_KEYS.PROACTIVE_LEARNER_STATS, snapshot)
      this.lastSnapshot = snapshot
    } catch (err) {
      logger.proactive?.warn('[ProactiveLearner] 持久化校准快照失败:', err)
    }
  }

  /**
   * 注册每日 04:00 校准 Cron 任务
   *
   * 去重策略：遍历 cronScheduler.getAllTasks()，若已存在同名任务则跳过注册
   * （避免每次启动重复注册，因 CronScheduler 会持久化任务）。
   */
  private async registerCalibrationTask(): Promise<void> {
    const { cronScheduler } = await import('../automation/CronScheduler')
    // 缓存引用供 dispose 使用
    this.cronScheduler = cronScheduler

    // 去重检查：已存在同名任务则跳过
    const existing = cronScheduler.getAllTasks().find((t) => t.name === CRON_TASK_NAME)
    if (existing) {
      this.registeredTaskId = existing.id
      logger.proactive?.info(
        `[ProactiveLearner] Cron 任务已存在（id=${existing.id}），跳过注册`,
      )
      return
    }

    // 注册新任务
    const task = cronScheduler.register({
      name: CRON_TASK_NAME,
      description: '每日 04:00 校准 ProactiveLearner 频率阈值',
      expression: CRON_EXPRESSION,
      command: CRON_COMMAND,
      active: true,
      maxCalls: 0, // 不限次数
    })
    this.registeredTaskId = task.id
    logger.proactive?.info(
      `[ProactiveLearner] 已注册 Cron 任务（id=${task.id}, expression=${CRON_EXPRESSION}）`,
    )
  }

  /**
   * 订阅 Cron 'task-execute' 事件
   *
   * 按 taskName 过滤，仅响应本学习器注册的校准任务。
   * 不使用 hookEvent（HookEventName 类型不含自定义事件）。
   */
  private subscribeCronExecution(): void {
    if (!this.cronScheduler) {
      logger.proactive?.warn('[ProactiveLearner] cronScheduler 未初始化，跳过订阅')
      return
    }

    const handler = async (event: { taskName: string; timestamp: number }) => {
      if (event.taskName !== CRON_TASK_NAME) return
      logger.proactive?.info('[ProactiveLearner] 收到 Cron 触发，开始校准...')
      try {
        await this.calibrate()
      } catch (err) {
        logger.proactive?.error('[ProactiveLearner] Cron 触发校准失败:', err)
      }
    }
    this.cronScheduler.on('task-execute', handler)
    this.unsubscribeCron = () => {
      this.cronScheduler?.off('task-execute', handler)
    }
  }
}

/** 单例实例 */
export const proactiveLearner = ProactiveLearner.getInstance()
