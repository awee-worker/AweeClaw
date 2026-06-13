/**
 * 场景权限守卫
 *
 * 在工具执行前校验场景是否声明了所需权限，防止越权操作。
 *
 * 权限映射：
 *   filesystem:read  → read_file, list_directory, search_files, codebase_search
 *   filesystem:write → write_file, create_file_or_folder, delete_file_or_folder
 *   database:query   → sql_query
 *   terminal:execute → run_command, read_terminal_output, send_terminal_input, stop_terminal
 *   network:request  → web_search, read_url
 *   clipboard:read   → clipboard_read
 *   clipboard:write  → clipboard_write
 *   notification:send → notification_send
 *   system:info      → system_info
 */

import type { ScenarioPermission } from '@shared/protocols/scenario-arch'
import { logger } from '@shared/toolkit/LogEngine'

// ─── 工具 → 权限映射 ─────────────────────────────────────

const TOOL_PERMISSION_MAP: Record<string, ScenarioPermission> = {
  // 文件系统读
  read_file: 'filesystem:read',
  list_directory: 'filesystem:read',
  search_files: 'filesystem:read',
  codebase_search: 'filesystem:read',
  // 文件系统写
  write_file: 'filesystem:write',
  create_file_or_folder: 'filesystem:write',
  delete_file_or_folder: 'filesystem:write',
  // 数据库
  sql_query: 'database:query',
  // 终端
  run_command: 'terminal:execute',
  read_terminal_output: 'terminal:execute',
  send_terminal_input: 'terminal:execute',
  stop_terminal: 'terminal:execute',
  // 网络
  web_search: 'network:request',
  read_url: 'network:request',
  // 剪贴板
  clipboard_read: 'clipboard:read',
  clipboard_write: 'clipboard:write',
  // 通知
  notification_send: 'notification:send',
  // 系统信息
  system_info: 'system:info',
}

// ─── 预定义权限组 ────────────────────────────────────────

const PERMISSION_GROUPS: Record<string, ScenarioPermission[]> = {
  basic: ['filesystem:read'],
  'file-access': ['filesystem:read', 'filesystem:write'],
  networking: ['network:request'],
  'full-filesystem': ['filesystem:read', 'filesystem:write'],
  'full-terminal': ['terminal:execute'],
  'full-database': ['database:connect', 'database:query'],
  all: [
    'filesystem:read',
    'filesystem:write',
    'database:connect',
    'database:query',
    'network:request',
    'terminal:execute',
    'clipboard:read',
    'clipboard:write',
    'notification:send',
    'system:info',
  ],
}

// ─── 权限守卫核心 ────────────────────────────────────────

export interface PermissionCheckResult {
  /** 是否允许执行 */
  allowed: boolean
  /** 缺失的权限列表 */
  missingPermissions: ScenarioPermission[]
  /** 拒绝原因 */
  reason?: string
}

export class PermissionGuard {
  private declaredPermissions: Set<ScenarioPermission>
  private scenarioId: string

  constructor(scenarioId: string, declaredPermissions: ScenarioPermission[]) {
    this.scenarioId = scenarioId
    this.declaredPermissions = new Set(declaredPermissions)
  }

  /**
   * 检查指定工具是否有权限执行
   */
  checkTool(toolName: string): PermissionCheckResult {
    const requiredPermission = TOOL_PERMISSION_MAP[toolName]

    // 工具不在映射表中 → 视为安全工具，允许执行（如 ask_user, todo_write 等）
    if (!requiredPermission) {
      return { allowed: true, missingPermissions: [] }
    }

    if (this.declaredPermissions.has(requiredPermission)) {
      return { allowed: true, missingPermissions: [] }
    }

    logger.agent.warn(
      `[PermissionGuard] Scenario "${this.scenarioId}" lacks permission "${requiredPermission}" for tool "${toolName}"`,
    )

    return {
      allowed: false,
      missingPermissions: [requiredPermission],
      reason: `Scenario "${this.scenarioId}" does not have the required permission "${requiredPermission}" to execute tool "${toolName}".`,
    }
  }

  /**
   * 批量检查多个工具
   */
  checkTools(toolNames: string[]): PermissionCheckResult {
    const missingPermissions: ScenarioPermission[] = []

    for (const toolName of toolNames) {
      const requiredPermission = TOOL_PERMISSION_MAP[toolName]
      if (requiredPermission && !this.declaredPermissions.has(requiredPermission)) {
        missingPermissions.push(requiredPermission)
      }
    }

    if (missingPermissions.length > 0) {
      const uniqueMissing = [...new Set(missingPermissions)]
      logger.agent.warn(
        `[PermissionGuard] Scenario "${this.scenarioId}" lacks permissions: ${uniqueMissing.join(', ')}`,
      )
      return {
        allowed: false,
        missingPermissions: uniqueMissing,
        reason: `Scenario "${this.scenarioId}" is missing permissions: ${uniqueMissing.join(', ')}.`,
      }
    }

    return { allowed: true, missingPermissions: [] }
  }

  /**
   * 检查是否拥有某个权限
   */
  hasPermission(permission: ScenarioPermission): boolean {
    return this.declaredPermissions.has(permission)
  }

  /**
   * 获取已声明的权限列表
   */
  getDeclaredPermissions(): ScenarioPermission[] {
    return [...this.declaredPermissions]
  }

  /**
   * 获取工具所需的权限
   */
  static getToolRequiredPermission(toolName: string): ScenarioPermission | null {
    return TOOL_PERMISSION_MAP[toolName] || null
  }

  /**
   * 展开权限组为具体权限列表
   */
  static expandPermissionGroup(groupName: string): ScenarioPermission[] {
    return PERMISSION_GROUPS[groupName] || []
  }

  /**
   * 验证权限列表是否合法（过滤掉无效权限）
   */
  static validatePermissions(permissions: string[]): {
    valid: ScenarioPermission[]
    invalid: string[]
  } {
    const validPermissions: ScenarioPermission[] = [
      'filesystem:read',
      'filesystem:write',
      'database:connect',
      'database:query',
      'network:request',
      'terminal:execute',
      'clipboard:read',
      'clipboard:write',
      'notification:send',
      'system:info',
    ]

    const valid: ScenarioPermission[] = []
    const invalid: string[] = []

    for (const perm of permissions) {
      if (validPermissions.includes(perm as ScenarioPermission)) {
        valid.push(perm as ScenarioPermission)
      } else {
        invalid.push(perm)
      }
    }

    return { valid, invalid }
  }
}