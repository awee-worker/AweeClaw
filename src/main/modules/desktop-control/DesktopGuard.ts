/**
 * 桌面控制权限守卫
 * 基于 SecurityPolicyEngine 进行操作鉴权
 * 支持 ALLOWED / ASK / DENIED 三级权限
 */

import { BrowserWindow } from 'electron'
import {
  OperationType,
  PermissionLevel,
  securityManager,
} from '@main/guard/securityPolicyEngine'
import { logger } from '@shared/toolkit/LogEngine'

/** 权限检查结果 */
export interface PermissionCheckResult {
  allowed: boolean
  level: PermissionLevel
  /** 当 level=ASK 时，需要前端弹窗确认 */
  needConfirm: boolean
  /** 用户授权后是否记住选择 */
  rememberable: boolean
}

/** 用户确认请求（发送给前端） */
export interface ConfirmationRequest {
  id: string
  operation: OperationType
  operationLabel: string
  target: string
  args?: unknown[]
  riskLevel: 'low' | 'medium' | 'high'
  message: string
}

/** 用户确认响应 */
export interface ConfirmationResponse {
  approved: boolean
  remember: boolean
}

/** 确认结果类型（区分超时和拒绝，便于 AI 理解失败原因） */
export type ConfirmationOutcome = 'approved' | 'denied' | 'timeout'

/** 确认结果详情 */
export interface ConfirmationResult {
  outcome: ConfirmationOutcome
  remember: boolean
}

/** 操作类型到中文标签的映射 */
const OPERATION_LABELS: Partial<Record<OperationType, string>> = {
  [OperationType.APP_LAUNCH]: '启动应用',
  [OperationType.APP_QUIT]: '退出应用',
  [OperationType.WINDOW_CONTROL]: '窗口管理',
  [OperationType.WINDOW_MOVE]: '窗口移动',
  [OperationType.SCREEN_CAPTURE]: '屏幕截图',
  [OperationType.MOUSE_INPUT]: '鼠标模拟',
  [OperationType.KEYBOARD_INPUT]: '键盘模拟',
  [OperationType.PROCESS_KILL]: '终止进程',
  [OperationType.SYSTEM_SETTING]: '系统设置',
  [OperationType.WORKFLOW_EXECUTE]: '执行工作流',
  [OperationType.VISUAL_AGENT_LOOP]: '视觉智能体循环',
}

/** 风险等级映射 */
const RISK_LEVELS: Partial<Record<OperationType, 'low' | 'medium' | 'high'>> = {
  [OperationType.APP_LAUNCH]: 'low',
  [OperationType.APP_QUIT]: 'medium',
  [OperationType.WINDOW_CONTROL]: 'low',
  [OperationType.WINDOW_MOVE]: 'low',
  [OperationType.SCREEN_CAPTURE]: 'low',
  [OperationType.MOUSE_INPUT]: 'medium',
  [OperationType.KEYBOARD_INPUT]: 'medium',
  [OperationType.PROCESS_KILL]: 'high',
  [OperationType.SYSTEM_SETTING]: 'medium',
  [OperationType.WORKFLOW_EXECUTE]: 'high',
  [OperationType.VISUAL_AGENT_LOOP]: 'high',
}

export class DesktopGuard {
  private pendingConfirmations = new Map<string, {
    resolve: (resp: ConfirmationResponse) => void
    timer: NodeJS.Timeout
  }>()

  /**
   * 检查权限（同步，仅查询策略，不触发用户确认）
   * @returns allowed=true 表示可直接执行；needConfirm=true 表示需要弹窗确认
   */
  checkPermission(operation: OperationType): PermissionCheckResult {
    const level = securityManager.getPermissionConfig(operation)

    if (level === PermissionLevel.DENIED) {
      return { allowed: false, level, needConfirm: false, rememberable: false }
    }
    if (level === PermissionLevel.ALLOWED) {
      return { allowed: true, level, needConfirm: false, rememberable: false }
    }
    // ASK
    return { allowed: false, level, needConfirm: true, rememberable: true }
  }

  /**
   * 请求用户确认（通过 IPC 推送给前端）
   * 返回确认结果（区分 approved/denied/timeout）
   */
  async requestConfirmation(
    window: BrowserWindow,
    operation: OperationType,
    target: string,
    args?: unknown[],
  ): Promise<ConfirmationResult> {
    const id = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const request: ConfirmationRequest = {
      id,
      operation,
      operationLabel: OPERATION_LABELS[operation] || operation,
      target,
      args,
      riskLevel: RISK_LEVELS[operation] || 'medium',
      message: `请求${OPERATION_LABELS[operation] || operation}：${target}`,
    }

    logger.desktop.info(`[DesktopGuard] Requesting confirmation for ${operation}: ${target}`)

    return new Promise<ConfirmationResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingConfirmations.delete(id)
        logger.desktop.warn(`[DesktopGuard] Confirmation timeout for ${id}`)
        resolve({ outcome: 'timeout', remember: false })
      }, 60_000)

      this.pendingConfirmations.set(id, {
        resolve: (resp: ConfirmationResponse) =>
          resolve({
            outcome: resp.approved ? 'approved' : 'denied',
            remember: resp.remember,
          }),
        timer,
      })

      // 发送给前端
      window.webContents.send('desktop:confirmation-request', request)
    })
  }

  /**
   * 前端用户确认后回调
   */
  resolveConfirmation(id: string, response: ConfirmationResponse): void {
    const pending = this.pendingConfirmations.get(id)
    if (!pending) {
      logger.desktop.warn(`[DesktopGuard] Unknown confirmation id: ${id}`)
      return
    }

    clearTimeout(pending.timer)
    this.pendingConfirmations.delete(id)
    pending.resolve(response)

    logger.desktop.info(`[DesktopGuard] Confirmation ${id} resolved: ${response.approved ? 'approved' : 'denied'}`)
  }
}
