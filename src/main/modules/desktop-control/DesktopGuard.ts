/**
 * 桌面控制权限守卫
 * 基于 SecurityPolicyEngine 进行操作鉴权
 * 支持 ALLOWED / ASK / DENIED 三级权限
 */

import {
  OperationType,
  PermissionLevel,
  securityManager,
} from '@main/guard/securityPolicyEngine'

/** 权限检查结果 */
export interface PermissionCheckResult {
  allowed: boolean
  level: PermissionLevel
  /** 当 level=ASK 时，需要前端弹窗确认 */
  needConfirm: boolean
  /** 用户授权后是否记住选择 */
  rememberable: boolean
}

export class DesktopGuard {
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
}
