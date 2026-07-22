/**
 * 用户活动追踪器（阶段10 s10-08 新增）
 *
 * 轻量级单例，记录用户最后活动时间，供 CodingScenario 的"调试卡顿"探测器使用：
 * - 10 分钟无操作 + 最近有错误 → 主动提供排查建议
 *
 * 数据流：
 *   渲染层 mousemove/keydown 事件（节流 5s）→ IPC → recordActivity()
 *     → ActivityTracker（内存时间戳）
 *     → DebugStallDetector 读取 getIdleMs()
 *
 * 设计原则：
 * - 纯内存单时间戳，极低开销
 * - 渲染层节流上报，避免 IPC 频繁调用
 * - powerMonitor 作为兜底（系统级空闲检测）
 *
 * @module proactive/scenarios/ActivityTracker
 */

import { powerMonitor } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// ActivityTracker 单例
// ============================================================

export class ActivityTracker {
  private static instance: ActivityTracker | null = null

  /** 最后一次用户活动时间戳（ms） */
  private lastActivityAt: number = Date.now()

  /** 是否已初始化（注册 powerMonitor 监听） */
  private initialized: boolean = false

  private constructor() {}

  static getInstance(): ActivityTracker {
    if (!ActivityTracker.instance) {
      ActivityTracker.instance = new ActivityTracker()
    }
    return ActivityTracker.instance
  }

  // ============================================================
  // 初始化（注册系统级空闲检测）
  // ============================================================

  /** 初始化（在 app ready 后调用） */
  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    try {
      // 监听系统级用户活动（resume/unlock）
      powerMonitor.on('resume', () => {
        this.recordActivity()
      })
      powerMonitor.on('unlock-screen', () => {
        this.recordActivity()
      })
      logger.proactive?.info('[ActivityTracker] 已注册 powerMonitor 监听')
    } catch (e) {
      logger.proactive?.warn('[ActivityTracker] powerMonitor 注册失败:', e)
    }
  }

  // ============================================================
  // 写入接口（由渲染层 IPC 调用）
  // ============================================================

  /** 记录用户活动（更新最后活动时间戳） */
  recordActivity(): void {
    this.lastActivityAt = Date.now()
  }

  // ============================================================
  // 读取接口（由探测器调用）
  // ============================================================

  /**
   * 获取用户空闲时长（ms）
   * @returns 距离上次活动的毫秒数
   */
  getIdleMs(): number {
    return Date.now() - this.lastActivityAt
  }

  /**
   * 判断用户是否空闲超过指定时长
   * @param thresholdMs 阈值（ms）
   */
  isIdle(thresholdMs: number): boolean {
    return this.getIdleMs() >= thresholdMs
  }

  /** 获取最后活动时间戳 */
  getLastActivityAt(): number {
    return this.lastActivityAt
  }
}

/** 单例实例 */
export const activityTracker = ActivityTracker.getInstance()
