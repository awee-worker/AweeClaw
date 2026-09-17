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
 *
 * 支持项目级（per-workspace）权限覆盖，用于自定义模式下的细粒度控制
 */

import type { ScenarioPermission } from '@shared/protocols/scenario-arch'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'

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
  // Git：只读查询按文件系统读授权（只读仓库不写盘）；
  // 提交 / 分支 / 远程同步属于仓库写操作，与终端同级授权
  git_status: 'filesystem:read',
  git_diff: 'filesystem:read',
  git_log: 'filesystem:read',
  git_commit: 'terminal:execute',
  git_branch: 'terminal:execute',
  git_sync: 'terminal:execute',
  // 隔离工作区会在工作区同级目录新建工作目录，审计封存会提交并打 tag —— 均与终端同级
  git_worktree: 'terminal:execute',
  git_audit: 'terminal:execute',
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
    'mcp:call',
  ],
}

// ─── 项目级权限配置 ────────────────────────────────────────

export interface ProjectPermissionConfig {
  /** 允许的工具白名单（如果为空则不过滤） */
  allowedTools?: string[]
  /** 禁止的工具黑名单 */
  blockedTools?: string[]
}

// ─── 权限守卫核心 ────────────────────────────────────────

/**
 * 权限检查缺失项：
 * - 场景级权限（ScenarioPermission）
 * - 项目级策略标记（project:blocked / project:whitelist，非真实场景权限，仅用于说明拒绝来源）
 */
export type MissingPermission =
  | ScenarioPermission
  | 'project:blocked'
  | 'project:whitelist'

export interface PermissionCheckResult {
  /** 是否允许执行 */
  allowed: boolean
  /** 缺失的权限列表 */
  missingPermissions: MissingPermission[]
  /** 拒绝原因 */
  reason?: string
}

export class PermissionGuard {
  private declaredPermissions: Set<ScenarioPermission>
  private scenarioId: string
  private projectConfig?: ProjectPermissionConfig
  private workspacePath?: string

  constructor(
    scenarioId: string,
    declaredPermissions: ScenarioPermission[],
    workspacePath?: string,
  ) {
    this.scenarioId = scenarioId
    this.workspacePath = workspacePath
    this.declaredPermissions = new Set(declaredPermissions)
    
    // 加载项目级权限配置
    if (workspacePath) {
      this.projectConfig = this.loadProjectConfig(workspacePath)
    }
  }

  /**
   * 加载项目级权限配置
   */
  private loadProjectConfig(workspacePath: string): ProjectPermissionConfig | undefined {
    try {
      const key = `project:${workspacePath}:permissions`
      return StorageService.get<ProjectPermissionConfig>(key) ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * 检查指定工具是否有权限执行
   *
   * 优先级：项目级黑名单 > 项目级白名单 > 场景级权限
   *
   * 注意：MCP 工具（`mcp_` 前缀）统一要求 `mcp:call` 权限，
   * 不在 TOOL_PERMISSION_MAP 中逐个映射。
   */
  checkTool(toolName: string): PermissionCheckResult {
    // 1. 项目级黑名单优先检查
    if (this.projectConfig?.blockedTools?.includes(toolName)) {
      return {
        allowed: false,
        missingPermissions: ['project:blocked'],
        reason: `Tool "${toolName}" is blocked by project configuration.`,
      }
    }

    // 2. 项目级白名单检查（如果配置了白名单）
    if (this.projectConfig?.allowedTools && this.projectConfig.allowedTools.length > 0) {
      if (!this.projectConfig.allowedTools.includes(toolName)) {
        return {
          allowed: false,
          missingPermissions: ['project:whitelist'],
          reason: `Tool "${toolName}" is not in the project whitelist.`,
        }
      }
    }

    // 3. MCP 工具统一要求 mcp:call 权限
    if (toolName.startsWith('mcp_')) {
      if (this.declaredPermissions.has('mcp:call')) {
        return { allowed: true, missingPermissions: [] }
      }
      logger.agent.warn(
        `[PermissionGuard] Scenario "${this.scenarioId}" lacks permission "mcp:call" for MCP tool "${toolName}"`,
      )
      return {
        allowed: false,
        missingPermissions: ['mcp:call'],
        reason: `Scenario "${this.scenarioId}" does not have the required permission "mcp:call" to call MCP tool "${toolName}".`,
      }
    }

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
   * 获取项目级权限配置
   */
  getProjectConfig(): ProjectPermissionConfig | null {
    return this.projectConfig ?? null
  }

  /**
   * 更新项目级权限配置
   */
  updateProjectConfig(config: Partial<ProjectPermissionConfig>): void {
    if (!this.workspacePath) return
    
    this.projectConfig = {
      ...this.projectConfig,
      ...config,
    }
    
    const key = `project:${this.workspacePath}:permissions`
    StorageService.set(key, this.projectConfig)
    logger.agent.info(`[PermissionGuard] Updated project config for ${this.workspacePath}`)
  }

  /**
   * 重置为场景默认权限
   */
  resetProjectConfig(): void {
    if (!this.workspacePath) return
    
    this.projectConfig = undefined
    const key = `project:${this.workspacePath}:permissions`
    StorageService.remove(key)
    logger.agent.info(`[PermissionGuard] Reset project config for ${this.workspacePath}`)
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
      'mcp:call',
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