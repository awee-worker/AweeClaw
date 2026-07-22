/**
 * 主动行动触发器 — 5 级 severity 路由（阶段10 s10-04 新增）
 *
 * 职责：
 * - 监听 ProactiveDecisionEngine 的 'proposal' 事件
 * - 持久化提案到 ProactiveStore（insertProposal + audit 'created'）
 * - 调用权限闸门（s10-05 注入，默认放行）校验是否允许派发
 * - 按 severity 路由到 5 个处理通道：
 *     info     → 静默记录（仅 audit log）
 *     low      → Electron 系统通知
 *     medium   → IPC 推送到渲染层显示 SuggestionCard（s10-06 实现 UI）
 *     high     → IPC 通知渲染层调用 Agent.send 发起主动对话
 *     critical → IPC 通知渲染层执行预授权命令（失败降级为 high）
 * - 每个派发动作写入 audit log（dispatched/failed/blocked）
 *
 * 与渲染层的通信契约（webContents.send 频道）：
 * - 'proactive:proposal'       — medium 级提案推送给 SuggestionCard
 * - 'proactive:invoke-agent'   — high 级主动对话请求
 * - 'proactive:execute-action' — critical 级主动执行请求
 *
 * @module proactive/ProactiveActionTrigger
 */

import { BrowserWindow, Notification, NotificationConstructorOptions } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { proactiveDecisionEngine } from './ProactiveDecisionEngine'
import { proactiveStore } from './ProactiveStore'
import type { ProactiveProposal, ProactiveSeverity } from './ProactiveInterface'

// ============================================================
// 类型定义
// ============================================================

/**
 * 权限校验器接口（s10-05 ProactivePermission 实现并注入）
 *
 * 返回值：
 * - { allowed: true }                                  — 允许派发
 * - { allowed: false, reason: 'quiet_hours' }         — 勿扰时段拦截
 * - { allowed: false, reason: 'category_disabled' }   — 分类未开启
 * - { allowed: false, reason: 'level_blocked' }       — 等级不足
 * - { allowed: false, reason: 'frequency_exceeded' }  — 频率超限
 */
export interface PermissionChecker {
  (proposal: ProactiveProposal): {
    allowed: boolean
    reason?: 'quiet_hours' | 'category_disabled' | 'level_blocked' | 'frequency_exceeded' | 'disabled' | 'critical_not_whitelisted'
    /** 降级后的 severity（quiet_hours/critical_not_whitelisted 时可能填） */
    effectiveSeverity?: ProactiveSeverity
  }
}

/**
 * 派发回调接口（s10-05 ProactivePermission 实现并注入）
 * 用于在派发成功后记录频率、更新统计等
 */
export interface DispatchCallback {
  /** 派发成功后回调（传入实际派发的 severity） */
  (proposal: ProactiveProposal, effectiveSeverity: ProactiveSeverity): void
}

/** 派发结果 */
export interface DispatchResult {
  /** 是否成功派发到目标通道 */
  success: boolean
  /** 实际派发的 severity（critical 降级时可能变为 high） */
  effectiveSeverity: ProactiveSeverity
  /** 失败原因（success=false 时填） */
  error?: string
  /** 是否发生了降级 */
  degraded: boolean
}

// ============================================================
// 常量
// ============================================================

/** 渲染层 IPC 频道 */
const CHANNEL_PROPOSAL = 'proactive:proposal'        // medium → SuggestionCard
const CHANNEL_INVOKE_AGENT = 'proactive:invoke-agent' // high → Agent.send
const CHANNEL_EXECUTE_ACTION = 'proactive:execute-action' // critical → 执行预授权动作

/** 通知点击后聚焦窗口的延迟（ms） */
const NOTIFICATION_FOCUS_DELAY_MS = 100

// ============================================================
// ProactiveActionTrigger 实现
// ============================================================

/**
 * 主动行动触发器单例
 *
 * 使用方式：
 * ```ts
 * const trigger = ProactiveActionTrigger.getInstance()
 * trigger.start()  // 启动监听
 * trigger.stop()   // 停止监听
 *
 * // s10-05 注入权限校验器
 * trigger.setPermissionChecker((proposal) => {
 *   // 自定义权限逻辑
 *   return { allowed: true }
 * })
 * ```
 */
export class ProactiveActionTrigger {
  private static instance: ProactiveActionTrigger | null = null

  /** 是否已启动 */
  private started = false

  /** 权限校验器（s10-05 注入；默认放行所有提案） */
  private permissionChecker: PermissionChecker | null = null

  /** 派发成功回调（s10-05 注入；用于频率限制记录） */
  private dispatchCallback: DispatchCallback | null = null

  /** proposal 事件回调引用（用于精确解绑） */
  private proposalHandler: ((proposal: ProactiveProposal) => void) | null = null

  private constructor() {}

  static getInstance(): ProactiveActionTrigger {
    if (!ProactiveActionTrigger.instance) {
      ProactiveActionTrigger.instance = new ProactiveActionTrigger()
    }
    return ProactiveActionTrigger.instance
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 启动触发器：订阅决策引擎的 proposal 事件
   * 幂等：重复调用安全
   */
  start(): void {
    if (this.started) {
      logger.proactive?.debug('[ProactiveActionTrigger] 已启动，忽略重复 start')
      return
    }

    this.proposalHandler = (proposal) => {
      this.dispatch(proposal).catch((err) => {
        logger.proactive?.error(
          `[ProactiveActionTrigger] 派发提案异常: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }

    proactiveDecisionEngine.on('proposal', this.proposalHandler)
    this.started = true
    logger.proactive?.info('[ProactiveActionTrigger] 已启动，监听 decisionEngine 的 proposal 事件')
  }

  /**
   * 停止触发器：解绑事件订阅
   * 幂等：重复调用安全
   */
  stop(): void {
    if (!this.started) return
    if (this.proposalHandler) {
      proactiveDecisionEngine.off('proposal', this.proposalHandler)
      this.proposalHandler = null
    }
    this.started = false
    logger.proactive?.info('[ProactiveActionTrigger] 已停止')
  }

  /** 是否正在运行 */
  isRunning(): boolean {
    return this.started
  }

  // ============================================================
  // 权限校验器注入（s10-05 使用）
  // ============================================================

  /**
   * 注入权限校验器
   * 传入 null 清除校验器（恢复默认放行）
   */
  setPermissionChecker(checker: PermissionChecker | null): void {
    this.permissionChecker = checker
    logger.proactive?.info(
      checker ? '[ProactiveActionTrigger] 权限校验器已注入' : '[ProactiveActionTrigger] 权限校验器已清除',
    )
  }

  /**
   * 注入派发成功回调（用于频率限制记录）
   * 传入 null 清除回调
   */
  setDispatchCallback(callback: DispatchCallback | null): void {
    this.dispatchCallback = callback
    logger.proactive?.info(
      callback ? '[ProactiveActionTrigger] 派发回调已注入' : '[ProactiveActionTrigger] 派发回调已清除',
    )
  }

  // ============================================================
  // 核心派发逻辑
  // ============================================================

  /**
   * 派发提案（按 severity 路由）
   *
   * 流程：
   * 1. 持久化提案到 ProactiveStore + 写入 audit 'created'
   * 2. 权限校验（不通过则写 audit 'blocked' 并返回）
   * 3. 按 severity 路由到对应通道
   * 4. 路由成功写 audit 'dispatched'，失败写 audit 'failed'
   *
   * @param proposal 决策引擎产出的提案
   * @returns 派发结果
   */
  async dispatch(proposal: ProactiveProposal): Promise<DispatchResult> {
    // 1. 持久化提案
    try {
      proactiveStore.insertProposal(proposal, 'pending')
      proactiveStore.insertAuditLog(proposal.id, 'created', {
        source: proposal.source,
        severity: proposal.severity,
        title: proposal.title,
        trigger: proposal.trigger,
      })
    } catch (err) {
      logger.proactive?.warn(
        `[ProactiveActionTrigger] 持久化提案失败，继续派发: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 2. 权限校验
    if (this.permissionChecker) {
      try {
        const result = this.permissionChecker(proposal)
        if (!result.allowed) {
          proactiveStore.insertAuditLog(proposal.id, 'blocked', {
            reason: result.reason ?? 'unknown',
          })
          proactiveStore.updateProposalStatus(proposal.id, 'dismissed')
          logger.proactive?.info(
            `[ProactiveActionTrigger] 提案被权限拦截: id=${proposal.id} reason=${result.reason}`,
          )
          return {
            success: false,
            effectiveSeverity: proposal.severity,
            error: `blocked: ${result.reason}`,
            degraded: false,
          }
        }
      } catch (err) {
        logger.proactive?.warn(
          `[ProactiveActionTrigger] 权限校验异常，按放行处理: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // 3. 写入 audit 'permitted'
    proactiveStore.insertAuditLog(proposal.id, 'permitted', {
      severity: proposal.severity,
      action: proposal.action.type,
    })

    // 4. 按 severity 路由
    try {
      const result = await this.routeBySeverity(proposal)

      // 派发成功后通知权限模块（用于频率限制计数）
      if (result.success && this.dispatchCallback) {
        try {
          this.dispatchCallback(proposal, result.effectiveSeverity)
        } catch (cbErr) {
          logger.proactive?.warn(
            `[ProactiveActionTrigger] 派发回调异常: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`,
          )
        }
      }

      return result
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      proactiveStore.insertAuditLog(proposal.id, 'failed', {
        severity: proposal.severity,
        error: errMsg,
      })
      logger.proactive?.error(`[ProactiveActionTrigger] 派发失败: id=${proposal.id} err=${errMsg}`)
      return {
        success: false,
        effectiveSeverity: proposal.severity,
        error: errMsg,
        degraded: false,
      }
    }
  }

  /**
   * 按 severity 路由到对应通道
   */
  private async routeBySeverity(proposal: ProactiveProposal): Promise<DispatchResult> {
    switch (proposal.severity) {
      case 'info':
        return this.handleInfo(proposal)
      case 'low':
        return this.handleLow(proposal)
      case 'medium':
        return this.handleMedium(proposal)
      case 'high':
        return this.handleHigh(proposal)
      case 'critical':
        return this.handleCritical(proposal)
      default:
        // 理论上不会走到，但兜底
        return this.handleInfo(proposal)
    }
  }

  // ============================================================
  // 5 级 severity 路由实现
  // ============================================================

  /**
   * info 级：静默记录
   * 仅写入 audit log，不打扰用户
   */
  private async handleInfo(proposal: ProactiveProposal): Promise<DispatchResult> {
    logger.proactive?.info(`[ProactiveActionTrigger] info 静默记录: ${proposal.title}`)
    proactiveStore.updateProposalStatus(proposal.id, 'notified')
    proactiveStore.insertAuditLog(proposal.id, 'dispatched', {
      channel: 'silent',
      severity: 'info',
    })
    return { success: true, effectiveSeverity: 'info', degraded: false }
  }

  /**
   * low 级：Electron 系统通知
   * 点击通知可聚焦主窗口并展示详情
   */
  private async handleLow(proposal: ProactiveProposal): Promise<DispatchResult> {
    logger.proactive?.info(`[ProactiveActionTrigger] low 系统通知: ${proposal.title}`)

    try {
      const options: NotificationConstructorOptions = {
        title: proposal.title,
        body: proposal.description,
        silent: false,
      }

      // 通知点击 → 聚焦主窗口 + 推送详情到渲染层
      const notification = new Notification(options)
      notification.on('click', () => {
        setTimeout(() => this.focusMainWindow(), NOTIFICATION_FOCUS_DELAY_MS)
        // 同时推送给渲染层，让其展示完整详情
        this.broadcastToRenderer(CHANNEL_PROPOSAL, proposal)
      })

      notification.show()
    } catch (err) {
      logger.proactive?.warn(
        `[ProactiveActionTrigger] 系统通知展示失败，降级为静默: ${err instanceof Error ? err.message : String(err)}`,
      )
      // 通知失败不影响整体派发，仍按已通知处理
    }

    proactiveStore.updateProposalStatus(proposal.id, 'notified')
    proactiveStore.insertAuditLog(proposal.id, 'dispatched', {
      channel: 'system_notification',
      severity: 'low',
    })
    return { success: true, effectiveSeverity: 'low', degraded: false }
  }

  /**
   * medium 级：IPC 推送到渲染层显示 SuggestionCard
   * 由 s10-06 ProactiveSuggestionCard 监听 'proactive:proposal' 频道并展示
   */
  private async handleMedium(proposal: ProactiveProposal): Promise<DispatchResult> {
    logger.proactive?.info(`[ProactiveActionTrigger] medium 建议卡片: ${proposal.title}`)

    const delivered = this.broadcastToRenderer(CHANNEL_PROPOSAL, proposal)

    if (!delivered) {
      // 无可用窗口，降级为系统通知
      logger.proactive?.warn('[ProactiveActionTrigger] 无可用窗口，medium 降级为 low')
      try {
        new Notification({ title: proposal.title, body: proposal.description }).show()
      } catch {
        // 通知也失败，仍按已建议处理（用户可在历史中查看）
      }
    }

    proactiveStore.updateProposalStatus(proposal.id, 'suggested')
    proactiveStore.insertAuditLog(proposal.id, 'dispatched', {
      channel: 'suggestion_card',
      severity: 'medium',
      delivered,
    })
    return {
      success: true,
      effectiveSeverity: delivered ? 'medium' : 'low',
      degraded: !delivered,
    }
  }

  /**
   * high 级：IPC 通知渲染层调用 Agent.send 发起主动对话
   *
   * 渲染层监听 'proactive:invoke-agent' 频道，收到后调用：
   * ```ts
   * Agent.send(
   *   proposal.action.payload,         // 主动发起的消息文本
   *   config,
   *   workspacePath,
   *   'agent',
   *   undefined,
   *   { isProactive: true, proposalId: proposal.id }
   * )
   * ```
   */
  private async handleHigh(proposal: ProactiveProposal): Promise<DispatchResult> {
    logger.proactive?.info(`[ProactiveActionTrigger] high 主动对话: ${proposal.title}`)

    const delivered = this.broadcastToRenderer(CHANNEL_INVOKE_AGENT, {
      proposalId: proposal.id,
      message: proposal.action.payload,
      source: proposal.source,
      title: proposal.title,
      reason: proposal.reason,
    })

    if (!delivered) {
      // 无可用窗口，降级为系统通知提醒用户
      logger.proactive?.warn('[ProactiveActionTrigger] 无可用窗口，high 降级为系统通知')
      try {
        new Notification({
          title: proposal.title,
          body: proposal.description,
        }).show()
      } catch {
        // 通知也失败，记录日志
      }
    }

    proactiveStore.updateProposalStatus(proposal.id, 'acted')
    proactiveStore.insertAuditLog(proposal.id, 'dispatched', {
      channel: 'invoke_agent',
      severity: 'high',
      delivered,
      message: proposal.action.payload,
    })
    return {
      success: true,
      effectiveSeverity: delivered ? 'high' : 'low',
      degraded: !delivered,
    }
  }

  /**
   * critical 级：IPC 通知渲染层执行预授权动作
   *
   * 渲染层监听 'proactive:execute-action' 频道，收到后：
   * - 校验 proposal.action.payload 是否在 criticalWhitelist 中
   * - 若是 IoT 联动规则 ID → 调用 IoT 服务触发
   * - 若是预设命令 → 调用终端执行
   * - 失败兜底：降级为 high（主动对话告知用户）
   *
   * 注意：实际的"预授权白名单"校验在 s10-05 ProactivePermission 中实现，
   *      此处仅负责派发执行请求；如果 s10-05 注入的权限校验器已拦截，
   *      不会走到这里。
   */
  private async handleCritical(proposal: ProactiveProposal): Promise<DispatchResult> {
    logger.proactive?.info(`[ProactiveActionTrigger] critical 主动执行: ${proposal.title}`)

    const delivered = this.broadcastToRenderer(CHANNEL_EXECUTE_ACTION, {
      proposalId: proposal.id,
      action: proposal.action,
      source: proposal.source,
      title: proposal.title,
      reason: proposal.reason,
    })

    if (!delivered) {
      // 无可用窗口，降级为 high（主动对话告知）
      logger.proactive?.warn('[ProactiveActionTrigger] 无可用窗口，critical 降级为 high')
      return this.handleHigh(proposal)
    }

    proactiveStore.updateProposalStatus(proposal.id, 'acted')
    proactiveStore.insertAuditLog(proposal.id, 'dispatched', {
      channel: 'execute_action',
      severity: 'critical',
      delivered,
      action: proposal.action.type,
      payload: proposal.action.payload,
    })
    return { success: true, effectiveSeverity: 'critical', degraded: false }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 向所有可用窗口广播 IPC 消息
   * @returns 是否至少送达一个窗口
   */
  private broadcastToRenderer(channel: string, ...args: unknown[]): boolean {
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    if (windows.length === 0) {
      logger.proactive?.warn(`[ProactiveActionTrigger] 无可用窗口，IPC 派发失败: ${channel}`)
      return false
    }

    for (const win of windows) {
      try {
        win.webContents.send(channel, ...args)
      } catch (err) {
        logger.proactive?.warn(
          `[ProactiveActionTrigger] 发送 IPC 失败 (windowId=${win.id}, channel=${channel}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
    return true
  }

  /** 聚焦主窗口（通知点击时使用） */
  private focusMainWindow(): void {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win) return
    try {
      if (win.isMinimized()) win.restore()
      win.focus()
    } catch (err) {
      logger.proactive?.warn(
        `[ProactiveActionTrigger] 聚焦窗口失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** 销毁触发器（停止监听 + 清理权限校验器 + 派发回调） */
  dispose(): void {
    this.stop()
    this.permissionChecker = null
    this.dispatchCallback = null
  }
}

// ============================================================
// 导出单例 + 类型
// ============================================================

export const proactiveActionTrigger = ProactiveActionTrigger.getInstance()
