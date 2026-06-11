/**
 * Session 生命周期管理器
 *
 * 借鉴 OpenClaw 的 Session 管理体系，增强：
 * 1. Daily Reset：每日自动重置 Session 上下文，防止上下文膨胀
 * 2. Idle Reset：空闲超时后自动归档，释放资源
 * 3. DM 隔离：每个 DM 用户拥有独立 Session
 * 4. Maintenance：定期清理过期 Session、压缩历史消息
 * 5. Session 状态机：idle → active → idle → archived
 *
 * @module session/SessionLifecycleManager
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import type { ChannelId } from '@shared/protocols/channel'

// ============================================
// Session 状态定义
// ============================================

export type SessionState = 'idle' | 'active' | 'idle_timeout' | 'archived' | 'maintenance'

export interface SessionLifecycleConfig {
  /** 空闲超时（毫秒），超过后 Session 进入 idle_timeout */
  idleTimeoutMs: number
  /** 每日重置时间（小时，0-23），如 4 表示凌晨 4 点重置 */
  dailyResetHour: number
  /** 是否启用每日重置 */
  dailyResetEnabled: boolean
  /** 归档前最大空闲时间（毫秒） */
  archiveIdleMs: number
  /** 最大历史 Session 保留数 */
  maxArchivedSessions: number
  /** 维护间隔（毫秒） */
  maintenanceIntervalMs: number
  /** 是否启用 DM 隔离（每个 DM 用户独立 Session） */
  dmIsolationEnabled: boolean
}

export const DEFAULT_SESSION_LIFECYCLE_CONFIG: SessionLifecycleConfig = {
  idleTimeoutMs: 30 * 60 * 1000,       // 30 分钟
  dailyResetHour: 4,
  dailyResetEnabled: true,
  archiveIdleMs: 24 * 60 * 60 * 1000,  // 24 小时
  maxArchivedSessions: 100,
  maintenanceIntervalMs: 60 * 60 * 1000, // 1 小时
  dmIsolationEnabled: true,
}

// ============================================
// Session 上下文
// ============================================

export interface SessionContext {
  /** Session ID */
  id: string
  /** 关联的 Agent ID */
  agentId: string
  /** Channel 来源（可选，DM 隔离时使用） */
  channelId?: ChannelId
  /** DM 用户 ID（可选，DM 隔离时使用） */
  dmUserId?: string
  /** 当前状态 */
  state: SessionState
  /** 创建时间 */
  createdAt: number
  /** 最后活跃时间 */
  lastActiveAt: number
  /** 消息计数 */
  messageCount: number
  /** 上下文 token 估算 */
  estimatedTokens: number
  /** 上次 daily reset 时间 */
  lastDailyResetAt: number
  /** 扩展数据 */
  extra: Record<string, unknown>
}

// ============================================
// Session 生命周期管理器
// ============================================

class SessionLifecycleManager extends EventEmitter {
  private sessions = new Map<string, SessionContext>()
  private config: SessionLifecycleConfig
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null
  private lastDailyResetDate: string = ''

  constructor(config?: Partial<SessionLifecycleConfig>) {
    super()
    this.config = { ...DEFAULT_SESSION_LIFECYCLE_CONFIG, ...config }
  }

  // ============================================
  // 生命周期控制
  // ============================================

  /**
   * 启动 Session 生命周期管理
   */
  start(): void {
    logger.session.info('[SessionLifecycle] Starting...')

    // 恢复持久化的配置
    this.restoreConfig()

    // 空闲检查定时器
    this.idleCheckTimer = setInterval(
      () => this.checkIdleSessions(),
      Math.min(this.config.idleTimeoutMs / 2, 60000) // 最长 1 分钟检查一次
    )

    // 每日重置检查定时器（每 5 分钟检查一次是否到了重置时间）
    this.dailyResetTimer = setInterval(
      () => this.checkDailyReset(),
      5 * 60 * 1000
    )

    // 维护定时器
    this.maintenanceTimer = setInterval(
      () => this.runMaintenance(),
      this.config.maintenanceIntervalMs
    )

    // 初始化每日重置日期
    this.lastDailyResetDate = this.getTodayDate()

    logger.session.info('[SessionLifecycle] Started')
  }

  /**
   * 停止 Session 生命周期管理
   */
  stop(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
    if (this.dailyResetTimer) {
      clearInterval(this.dailyResetTimer)
      this.dailyResetTimer = null
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer)
      this.maintenanceTimer = null
    }

    // 持久化配置
    this.persistConfig()

    logger.session.info('[SessionLifecycle] Stopped')
  }

  // ============================================
  // 持久化
  // ============================================

  /** 从持久化存储恢复配置 */
  private restoreConfig(): void {
    const saved = moduleDataStore.get<Partial<SessionLifecycleConfig>>(STORE_KEYS.SESSION_CONTEXTS)
    if (saved) {
      this.config = { ...this.config, ...saved }
      logger.session.info('[SessionLifecycle] Restored config from store')
    }
  }

  /** 持久化当前配置 */
  private persistConfig(): void {
    moduleDataStore.set(STORE_KEYS.SESSION_CONTEXTS, this.config)
  }

  /**
   * 更新配置（运行时动态修改）
   */
  updateConfig(partial: Partial<SessionLifecycleConfig>): void {
    this.config = { ...this.config, ...partial }
    this.persistConfig()
    logger.session.info('[SessionLifecycle] Config updated')
  }

  /**
   * 获取当前配置
   */
  getConfig(): SessionLifecycleConfig {
    return { ...this.config }
  }

  // ============================================
  // Session 操作
  // ============================================

  /**
   * 获取或创建 Session
   * DM 隔离模式下，每个 DM 用户创建独立 Session
   */
  getOrCreateSession(agentId: string, channelId?: ChannelId, dmUserId?: string): SessionContext {
    const sessionId = this.buildSessionId(agentId, channelId, dmUserId)
    let session = this.sessions.get(sessionId)

    if (!session) {
      session = {
        id: sessionId,
        agentId,
        channelId,
        dmUserId,
        state: 'idle',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 0,
        estimatedTokens: 0,
        lastDailyResetAt: Date.now(),
        extra: {},
      }
      this.sessions.set(sessionId, session)
      logger.session.info(`[SessionLifecycle] Created session: ${sessionId}`)
      this.emit('session-created', session)
    }

    return session
  }

  /**
   * 激活 Session（收到消息时调用）
   */
  activateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const prevState = session.state
    session.state = 'active'
    session.lastActiveAt = Date.now()
    session.messageCount++

    if (prevState !== 'active') {
      logger.session.info(`[SessionLifecycle] Session activated: ${sessionId} (was ${prevState})`)
      this.emit('session-activated', session, prevState)
    }
  }

  /**
   * 更新 Session token 估算
   */
  updateTokenEstimate(sessionId: string, tokens: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.estimatedTokens = tokens
  }

  /**
   * 获取 Session
   */
  getSession(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 获取指定 Agent 的所有活跃 Session
   */
  getSessionsForAgent(agentId: string): SessionContext[] {
    return Array.from(this.sessions.values()).filter(
      s => s.agentId === agentId && s.state !== 'archived'
    )
  }

  /**
   * 获取所有 Session
   */
  getAllSessions(): SessionContext[] {
    return Array.from(this.sessions.values())
  }

  /**
   * 手动重置 Session（清除上下文，保留元数据）
   */
  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    logger.session.info(`[SessionLifecycle] Resetting session: ${sessionId}`)
    session.estimatedTokens = 0
    session.messageCount = 0
    session.lastDailyResetAt = Date.now()
    session.state = 'idle'
    session.extra = {}

    this.emit('session-reset', session)
  }

  /**
   * 归档 Session
   */
  archiveSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.state = 'archived'
    logger.session.info(`[SessionLifecycle] Archived session: ${sessionId}`)
    this.emit('session-archived', session)
  }

  // ============================================
  // 定时任务（私有）
  // ============================================

  /**
   * 检查空闲 Session
   */
  private checkIdleSessions(): void {
    const now = Date.now()

    for (const session of this.sessions.values()) {
      if (session.state !== 'active') continue

      const idleTime = now - session.lastActiveAt
      if (idleTime > this.config.idleTimeoutMs) {
        session.state = 'idle_timeout'
        logger.session.info(`[SessionLifecycle] Session idle timeout: ${session.id} (idle ${Math.round(idleTime / 60000)}min)`)
        this.emit('session-idle-timeout', session)
      }
    }
  }

  /**
   * 检查是否需要每日重置
   */
  private checkDailyReset(): void {
    if (!this.config.dailyResetEnabled) return

    const today = this.getTodayDate()
    if (today === this.lastDailyResetDate) return

    const now = new Date()
    if (now.getHours() < this.config.dailyResetHour) return

    logger.session.info('[SessionLifecycle] Running daily reset...')
    this.lastDailyResetDate = today

    for (const session of this.sessions.values()) {
      if (session.state === 'archived') continue
      this.resetSession(session.id)
    }

    this.emit('daily-reset', today)
  }

  /**
   * 运行维护任务
   */
  private runMaintenance(): void {
    logger.session.info('[SessionLifecycle] Running maintenance...')
    const now = Date.now()
    let archivedCount = 0
    let removedCount = 0

    // 1. 归档长时间空闲的 Session
    for (const session of this.sessions.values()) {
      if (session.state === 'archived') continue

      const idleTime = now - session.lastActiveAt
      if (idleTime > this.config.archiveIdleMs) {
        this.archiveSession(session.id)
        archivedCount++
      }
    }

    // 2. 清理过多的归档 Session
    const archivedSessions = Array.from(this.sessions.values())
      .filter(s => s.state === 'archived')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    if (archivedSessions.length > this.config.maxArchivedSessions) {
      const toRemove = archivedSessions.slice(this.config.maxArchivedSessions)
      for (const session of toRemove) {
        this.sessions.delete(session.id)
        removedCount++
      }
    }

    logger.session.info(`[SessionLifecycle] Maintenance complete: archived=${archivedCount}, removed=${removedCount}`)
    this.emit('maintenance-complete', { archivedCount, removedCount })
  }

  // ============================================
  // 工具方法（私有）
  // ============================================

  private buildSessionId(agentId: string, channelId?: ChannelId, dmUserId?: string): string {
    if (this.config.dmIsolationEnabled && channelId && dmUserId) {
      return `session:${agentId}:${channelId}:${dmUserId}`
    }
    return `session:${agentId}`
  }

  private getTodayDate(): string {
    return new Date().toISOString().slice(0, 10)
  }
}

/** 全局 Session 生命周期管理器实例 */
export const sessionLifecycleManager = new SessionLifecycleManager()
