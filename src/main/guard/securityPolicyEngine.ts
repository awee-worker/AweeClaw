/**
 * 安全策略引擎 — 统一管理敏感操作的权限校验和审计日志
 *
 * 职责：
 * - 统一管理所有敏感操作的权限校验和审计日志
 * - 支持文件系统、终端、网络等操作的权限控制
 * - 提供安全事件通知机制
 *
 * 差异化特性（相比基础实现）：
 * - 场景权限策略（ScenarioPermissionPolicy）
 * - 操作频率限制
 * - 安全事件通知
 * - 内置场景策略（BUILTIN_SCENARIO_POLICIES）
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { logger } from '@shared/toolkit/LogEngine'
import Store from 'electron-store'
import * as path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { SECURITY_DEFAULTS, isSensitivePath as sharedIsSensitivePath } from '@shared/appConstants'
import { pathStartsWith, pathEquals } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'

// 敏感操作类型
export enum OperationType {
  // 文件系统
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_DELETE = 'file:delete',
  FILE_RENAME = 'file:rename',

  // 终端/命令
  SHELL_EXECUTE = 'shell:execute',
  TERMINAL_INTERACTIVE = 'terminal:interactive',

  // Git
  GIT_EXEC = 'git:exec',

  // 系统
  SYSTEM_SHELL = 'system:shell',

  // 桌面控制（Phase 1+）
  APP_LAUNCH = 'app:launch',              // 启动应用
  APP_QUIT = 'app:quit',                  // 退出应用
  WINDOW_CONTROL = 'window:control',      // 窗口管理（聚焦、最小化、关闭）
  WINDOW_MOVE = 'window:move',            // 窗口移动/调整大小
  SCREEN_CAPTURE = 'screen:capture',      // 截图
  MOUSE_INPUT = 'mouse:input',            // 鼠标模拟
  KEYBOARD_INPUT = 'keyboard:input',      // 键盘模拟
  PROCESS_KILL = 'process:kill',          // 终止进程
  SYSTEM_SETTING = 'system:setting',      // 修改系统设置（音量、亮度等）
  WORKFLOW_EXECUTE = 'workflow:execute',  // 执行工作流
  VISUAL_AGENT_LOOP = 'agent:visual-loop', // 视觉反馈闭环
}

// 安全配置接口
export interface SecurityConfig {
  enablePermissionConfirm: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

// 安全存储（独立于主配置）
const securityStore = new Store({ name: 'security' })

// 权限等级
export enum PermissionLevel {
  ALLOWED = 'allowed',      // 允许，无需确认
  ASK = 'ask',              // 每次需要用户确认
  DENIED = 'denied'         // 永远拒绝
}

interface PermissionConfig {
  [key: string]: PermissionLevel
}

// 来自 settingsSlice.ts 的定义
export interface SecurityPolicyPanel {
  enablePermissionConfirm: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  /** Shell 命令黑名单：命中即拒绝执行（实际生效的拦截策略） */
  deniedShellCommands?: string[]
  allowedGitSubcommands?: string[]
  showSecurityWarnings?: boolean
  /** 工作区外允许访问的目录列表 */
  allowedExternalDirectories?: string[]
}

interface SecurityModule {
  // 权限管理（主进程底线检查，不弹窗）
  checkPermission: (operation: OperationType, target: string) => Promise<boolean>
  setPermission: (operation: OperationType, level: PermissionLevel) => void

  // 工作区设置
  setWorkspacePath: (workspacePath: string | null) => void

  // 安全操作日志（通过 logger 输出，不写文件）
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void

  // 工作区安全边界
  validateWorkspacePath: (filePath: string, workspace: string | string[]) => boolean
  isSensitivePath: (filePath: string) => boolean

  // 白名单管理
  isAllowedCommand: (command: string, type: 'shell' | 'git') => boolean

  // 配置更新
  updateConfig: (config: Partial<SecurityPolicyPanel>) => void
}

// 默认权限配置
const DEFAULT_PERMISSIONS: PermissionConfig = {
  [OperationType.FILE_READ]: PermissionLevel.ALLOWED,
  [OperationType.FILE_WRITE]: PermissionLevel.ALLOWED,
  [OperationType.FILE_RENAME]: PermissionLevel.ALLOWED,
  [OperationType.FILE_DELETE]: PermissionLevel.ASK,
  [OperationType.SHELL_EXECUTE]: PermissionLevel.ALLOWED,
  [OperationType.TERMINAL_INTERACTIVE]: PermissionLevel.ALLOWED,
  [OperationType.GIT_EXEC]: PermissionLevel.ALLOWED,
  [OperationType.SYSTEM_SHELL]: PermissionLevel.DENIED,

  // 桌面控制默认权限
  [OperationType.APP_LAUNCH]: PermissionLevel.ASK,
  [OperationType.APP_QUIT]: PermissionLevel.ASK,
  [OperationType.WINDOW_CONTROL]: PermissionLevel.ALLOWED,
  [OperationType.WINDOW_MOVE]: PermissionLevel.ASK,
  [OperationType.SCREEN_CAPTURE]: PermissionLevel.ALLOWED,
  [OperationType.MOUSE_INPUT]: PermissionLevel.ASK,
  [OperationType.KEYBOARD_INPUT]: PermissionLevel.ASK,
  [OperationType.PROCESS_KILL]: PermissionLevel.DENIED,
  [OperationType.SYSTEM_SETTING]: PermissionLevel.ASK,
  [OperationType.WORKFLOW_EXECUTE]: PermissionLevel.ASK,
  [OperationType.VISUAL_AGENT_LOOP]: PermissionLevel.ASK,
}

// 命令白名单（已统一到 constants.ts）
// 默认 Shell 命令黑名单：与 SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS 一致
const DEFAULT_DENIED_SHELL_COMMANDS = new Set(SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS.map(cmd => cmd.toLowerCase()))

const ALLOWED_GIT_SUBCOMMANDS = new Set(SECURITY_DEFAULTS.GIT_SUBCOMMANDS.map(cmd => cmd.toLowerCase()))

function normalizeCommandName(command: string): string {
  const baseName = path.basename(command).toLowerCase()
  return process.platform === 'win32'
    ? baseName.replace(/\.(cmd|bat|exe)$/i, '')
    : baseName
}

class SecurityManager implements SecurityModule {
  private sessionStorage: Map<string, boolean> = new Map()
  private config: Partial<SecurityPolicyPanel> = {}
  private allowedAppPaths: string[] = []
  /** 用户配置的工作区外允许访问目录（持久化在 securitySettings.allowedExternalDirectories） */
  private allowedExternalDirs: string[] = []

  /**
   * 注册应用可信路径（如全局 Skills 目录）
   * 可信路径下的文件操作跳过工作区边界检查，但仍检查敏感路径
   */
  addAllowedAppPath(dirPath: string): void {
    const resolved = path.resolve(dirPath)
    if (!this.allowedAppPaths.includes(resolved)) {
      this.allowedAppPaths.push(resolved)
      logger.security.info(`[Security] Added allowed app path: ${resolved}`)
    }
  }

  /**
   * 检查路径是否在应用可信路径下
   */
  isAllowedAppPath(filePath: string): boolean {
    if (this.allowedAppPaths.length === 0) return false
    const resolved = path.resolve(filePath)
    return this.allowedAppPaths.some(allowed =>
      resolved === allowed || resolved.startsWith(allowed + path.sep)
    )
  }

  /**
   * 设置用户配置的工作区外允许访问目录列表
   * 这些目录及其子目录下的文件可读写，但仍受敏感路径检查约束
   * @param dirs 目录绝对路径数组；传空数组清空列表
   */
  setAllowedExternalDirectories(dirs: string[]): void {
    this.allowedExternalDirs = (dirs || [])
      .map(d => path.resolve(d))
      .filter(Boolean)
    logger.security.info(`[Security] Allowed external directories updated:`, this.allowedExternalDirs)
  }

  /**
   * 检查路径是否在用户配置的工作区外允许访问目录下
   * 与 isAllowedAppPath 区别：isAllowedAppPath 用于应用内置可信路径（如 Skills 目录），
   * isAllowedExternalDir 用于用户主动配置的额外可访问目录
   */
  isAllowedExternalDir(filePath: string): boolean {
    if (this.allowedExternalDirs.length === 0) return false
    const resolved = path.resolve(filePath)
    // 使用 pathStartsWith / pathEquals（忽略大小写与分隔符差异），
    // 与 validateWorkspacePath 及渲染层 assertPathSafety 保持同一套比较语义。
    // 原生 startsWith 是大小写敏感的，在 macOS/Windows 上会让「渲染层放行、
    // 主进程拒绝」——表现为文件莫名读不到（File not found）。
    return this.allowedExternalDirs.some(allowed =>
      pathStartsWith(resolved, allowed) || pathEquals(resolved, allowed)
    )
  }

  /**
   * 获取当前配置的工作区外允许访问目录列表
   */
  getAllowedExternalDirectories(): string[] {
    return [...this.allowedExternalDirs]
  }

  /**
   * 设置当前工作区路径（保留接口兼容）
   */
  setWorkspacePath(workspacePath: string | null) {
    logger.security.info('[Security] Workspace path set:', workspacePath)
  }

  /**
   * 更新安全配置
   */
  updateConfig(config: Partial<SecurityPolicyPanel>) {
    this.config = { ...this.config, ...config }
    logger.security.info('[Security] Configuration updated:', this.config)
  }

  /**
   * 检查权限
   */
  async checkPermission(operation: OperationType, target: string): Promise<boolean> {
    const sessionKey = `${operation}:${target}`
    if (this.sessionStorage.has(sessionKey)) {
      return this.sessionStorage.get(sessionKey)!
    }

    const config = this.getPermissionConfig(operation)

    if (config === PermissionLevel.DENIED) {
      this.logOperation(operation, target, false, { reason: 'Permission denied by policy' })
      return false
    }

    if (config === PermissionLevel.ASK) {
      if (this.config.enablePermissionConfirm === false) {
        return true
      }
      // 调用 Electron 原生对话框进行确认，避免引入 IPC 循环
      const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const operationLabels: Partial<Record<OperationType, string>> = {
        [OperationType.FILE_DELETE]: '删除文件',
        [OperationType.SHELL_EXECUTE]: '执行命令',
        [OperationType.GIT_EXEC]: '执行 Git 命令',
      }
      const label = operationLabels[operation] ?? operation
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['允许', '拒绝'],
        defaultId: 1,
        cancelId: 1,
        title: '操作确认',
        message: `是否允许以下操作？`,
        detail: `操作类型：${label}\n目标：${target}`,
      })
      const allowed = response === 0
      this.sessionStorage.set(sessionKey, allowed)
      return allowed
    }

    return true
  }

  /**
   * 设置权限
   */
  setPermission(operation: OperationType, level: PermissionLevel): void {
    const permissions = securityStore.get('permissions', {}) as PermissionConfig
    permissions[operation] = level
    securityStore.set('permissions', permissions)
  }

  /**
   * 获取权限配置
   * 公开方法，供 DesktopGuard 等模块同步查询权限级别
   */
  getPermissionConfig(operation: OperationType): PermissionLevel {
    const permissions = securityStore.get('permissions', {}) as PermissionConfig
    if (permissions[operation]) {
      return permissions[operation]
    }
    return DEFAULT_PERMISSIONS[operation] || PermissionLevel.ASK
  }

  /**
   * 记录安全操作日志（仅通过 logger 输出，不写文件）
   */
  logOperation(operation: OperationType, target: string, success: boolean, detail?: any): void {
    const status = success ? '✅' : '❌'
    const detailStr = detail ? ` | ${JSON.stringify(detail)}` : ''
    logger.security.info(`[Security] ${status} ${operation} - ${target}${detailStr}`)
  }

  /**
   * 验证工作区边界
   *
   * 检查顺序：
   * 1. 应用可信路径（isAllowedAppPath）：Skills 目录等内置可信路径，跳过工作区边界检查
   * 2. 用户配置的外部目录（isAllowedExternalDir）：用户主动配置的额外可访问目录，跳过工作区边界检查
   * 3. 严格工作区模式：未启用则允许所有路径（但仍检查敏感路径）
   * 4. 工作区边界：路径必须在给定工作区内且非敏感路径
   *
   * 所有检查均保留敏感路径检查（isSensitivePath），确保 .ssh、.aws 等系统敏感目录始终被拒绝
   */
  validateWorkspacePath(filePath: string, workspace: string | string[]): boolean {
    // 1. 可信应用路径跳过工作区边界检查，但仍检查敏感路径
    if (this.isAllowedAppPath(filePath)) {
      const resolvedPath = path.resolve(filePath)
      return !this.isSensitivePath(resolvedPath)
    }

    // 2. 用户配置的工作区外允许访问目录，跳过工作区边界检查，但仍检查敏感路径
    if (this.isAllowedExternalDir(filePath)) {
      const resolvedPath = path.resolve(filePath)
      return !this.isSensitivePath(resolvedPath)
    }

    // 3. 如果未启用严格工作区模式，允许所有路径（但仍检查敏感路径）
    if (this.config.strictWorkspaceMode === false) {
      const resolvedPath = path.resolve(filePath)
      return !this.isSensitivePath(resolvedPath)
    }
    
    if (!workspace) return false
    const workspaces = Array.isArray(workspace) ? workspace : [workspace]

    try {
      const resolvedPath = path.resolve(filePath)

      // 使用 pathStartsWith 进行路径比较（忽略大小写和分隔符差异）
      const isInside = workspaces.some(ws => {
        if (typeof ws !== 'string') return false
        const resolvedWorkspace = path.resolve(ws)
        return pathStartsWith(resolvedPath, resolvedWorkspace) || pathEquals(resolvedPath, resolvedWorkspace)
      })

      const isSensitive = typeof resolvedPath === 'string' && this.isSensitivePath(resolvedPath)

      return isInside && !isSensitive
    } catch (error) {
      logger.security.error('[Security] Path validation error:', error)
      return false
    }
  }

  /**
   * 检查敏感路径
   */
  isSensitivePath(filePath: string): boolean {
    if (typeof filePath !== 'string') return true
    return sharedIsSensitivePath(filePath)
  }

  /**
   * 检查命令是否允许执行
   *
   * 策略：
   * - git 类型：使用白名单策略（ALLOWED_GIT_SUBCOMMANDS），Git 子命令必须明确允许
   * - shell 类型：使用黑名单策略（deniedShellCommands），命令不在黑名单中即允许
   *
   * 这与项目安全约定一致：Shell 命令使用黑名单拦截危险命令，不使用白名单限制。
   * allowedShellCommands 字段保留用于配置兼容性，但不参与实际校验。
   */
  isAllowedCommand(command: string, type: 'shell' | 'git'): boolean {
    const parts = command.trim().split(/\s+/)
    const baseCommand = normalizeCommandName(parts[0] || '')

    if (type === 'git') {
      // Git 子命令使用白名单策略（不变）
      const subCommand = normalizeCommandName(parts[1] || '')
      return ALLOWED_GIT_SUBCOMMANDS.has(subCommand)
    }

    if (type === 'shell') {
      // Shell 命令使用黑名单策略：不在黑名单中即允许
      const deniedCommands = this.config.deniedShellCommands
      if (Array.isArray(deniedCommands) && deniedCommands.length > 0) {
        const normalizedDenied = deniedCommands.map(cmd => normalizeCommandName(cmd))
        if (normalizedDenied.includes(baseCommand)) {
          return false
        }
      }
      // 未配置黑名单时，使用默认黑名单兜底
      return !DEFAULT_DENIED_SHELL_COMMANDS.has(baseCommand)
    }

    return false
  }
}

export const securityManager = new SecurityManager()

export async function checkWorkspacePermission(
  filePath: string,
  workspace: string | string[] | null,
  operation: OperationType
): Promise<boolean> {
  if (!workspace) return false
  if (!securityManager.validateWorkspacePath(filePath, workspace)) return false
  if (securityManager.isSensitivePath(filePath)) return false
  return await securityManager.checkPermission(operation, filePath)
}

// ============================================
// [AweeClaw] 场景权限策略
// ============================================

export interface ScenarioPermissionPolicy {
  scenarioId: string
  allowedOperations: OperationType[]
  deniedOperations: OperationType[]
  maxFileOperationsPerMinute?: number
  maxShellOperationsPerMinute?: number
  restrictedPaths?: string[]
  allowedFileExtensions?: string[]
}

const scenarioPolicies = new Map<string, ScenarioPermissionPolicy>()
const scenarioOperationCounts = new Map<string, { fileOps: { count: number; resetAt: number }; shellOps: { count: number; resetAt: number } }>()

export function setScenarioPermissionPolicy(policy: ScenarioPermissionPolicy): void {
  scenarioPolicies.set(policy.scenarioId, policy)
  logger.security.info(`[Security] Scenario policy set: ${policy.scenarioId}`)
}

export function getScenarioPermissionPolicy(scenarioId: string): ScenarioPermissionPolicy | undefined {
  return scenarioPolicies.get(scenarioId)
}

export function removeScenarioPermissionPolicy(scenarioId: string): void {
  scenarioPolicies.delete(scenarioId)
  scenarioOperationCounts.delete(scenarioId)
}

export function listScenarioPermissionPolicies(): ScenarioPermissionPolicy[] {
  return Array.from(scenarioPolicies.values())
}

export function checkScenarioPermission(
  scenarioId: string,
  operation: OperationType,
  target?: string
): { allowed: boolean; reason?: string } {
  const policy = scenarioPolicies.get(scenarioId)
  if (!policy) return { allowed: true }

  if (policy.deniedOperations.includes(operation)) {
    return { allowed: false, reason: `Operation ${operation} is denied in scenario ${scenarioId}` }
  }

  if (policy.allowedOperations.length > 0 && !policy.allowedOperations.includes(operation)) {
    return { allowed: false, reason: `Operation ${operation} is not in allowed list for scenario ${scenarioId}` }
  }

  if (policy.restrictedPaths && target) {
    const resolvedTarget = path.resolve(target)
    if (policy.restrictedPaths.some(rp => resolvedTarget.startsWith(path.resolve(rp)))) {
      return { allowed: false, reason: `Path is restricted in scenario ${scenarioId}` }
    }
  }

  if (policy.allowedFileExtensions && target && operation.startsWith('file:')) {
    const ext = path.extname(target).toLowerCase()
    if (policy.allowedFileExtensions.length > 0 && !policy.allowedFileExtensions.includes(ext)) {
      return { allowed: false, reason: `File extension ${ext} is not allowed in scenario ${scenarioId}` }
    }
  }

  const now = Date.now()
  let counts = scenarioOperationCounts.get(scenarioId)
  if (!counts) {
    counts = {
      fileOps: { count: 0, resetAt: now + 60_000 },
      shellOps: { count: 0, resetAt: now + 60_000 },
    }
    scenarioOperationCounts.set(scenarioId, counts)
  }

  if (operation.startsWith('file:') && policy.maxFileOperationsPerMinute) {
    if (now > counts.fileOps.resetAt) {
      counts.fileOps = { count: 1, resetAt: now + 60_000 }
    } else {
      counts.fileOps.count++
      if (counts.fileOps.count > policy.maxFileOperationsPerMinute) {
        return { allowed: false, reason: `File operation rate limit exceeded in scenario ${scenarioId}` }
      }
    }
  }

  if (operation.startsWith('shell:') && policy.maxShellOperationsPerMinute) {
    if (now > counts.shellOps.resetAt) {
      counts.shellOps = { count: 1, resetAt: now + 60_000 }
    } else {
      counts.shellOps.count++
      if (counts.shellOps.count > policy.maxShellOperationsPerMinute) {
        return { allowed: false, reason: `Shell operation rate limit exceeded in scenario ${scenarioId}` }
      }
    }
  }

  return { allowed: true }
}

// ============================================
// [AweeClaw] 安全事件通知
// ============================================

export interface SecurityEvent {
  id: string
  timestamp: number
  type: 'permission_denied' | 'rate_limited' | 'sensitive_access' | 'workspace_violation' | 'policy_violation'
  operation: OperationType
  target: string
  scenarioId?: string
  reason?: string
}

const securityEvents: SecurityEvent[] = []
const MAX_SECURITY_EVENTS = 500
const eventListeners: ((event: SecurityEvent) => void)[] = []

export function onSecurityEvent(listener: (event: SecurityEvent) => void): () => void {
  eventListeners.push(listener)
  return () => {
    const idx = eventListeners.indexOf(listener)
    if (idx >= 0) eventListeners.splice(idx, 1)
  }
}

export function emitSecurityEvent(event: SecurityEvent): void {
  securityEvents.push(event)
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.splice(0, securityEvents.length - MAX_SECURITY_EVENTS)
  }
  for (const listener of eventListeners) {
    try { listener(event) } catch (e) { logger.security.warn('Security event listener error:', e) }
  }
}

export function getSecurityEvents(filter?: {
  type?: SecurityEvent['type']
  since?: number
  scenarioId?: string
  limit?: number
}): SecurityEvent[] {
  let results = [...securityEvents]
  if (filter?.type) results = results.filter(e => e.type === filter.type)
  if (filter?.since) results = results.filter(e => e.timestamp >= filter.since!)
  if (filter?.scenarioId) results = results.filter(e => e.scenarioId === filter.scenarioId)
  if (filter?.limit) results = results.slice(-filter.limit)
  return results
}

export function clearSecurityEvents(): void {
  securityEvents.length = 0
}

// ============================================
// [AweeClaw] 内置场景权限预设
// ============================================

export const BUILTIN_SCENARIO_POLICIES: Record<string, Partial<ScenarioPermissionPolicy>> = {
  'dev-assistant': {
    allowedOperations: [
      OperationType.FILE_READ, OperationType.FILE_WRITE, OperationType.FILE_RENAME,
      OperationType.SHELL_EXECUTE, OperationType.TERMINAL_INTERACTIVE, OperationType.GIT_EXEC,
    ],
    deniedOperations: [OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 120,
    maxShellOperationsPerMinute: 60,
  },
  'data-analyst': {
    allowedOperations: [
      OperationType.FILE_READ, OperationType.FILE_WRITE,
      OperationType.SHELL_EXECUTE, OperationType.TERMINAL_INTERACTIVE,
    ],
    deniedOperations: [OperationType.FILE_DELETE, OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 60,
    maxShellOperationsPerMinute: 30,
  },
  'creative-writer': {
    allowedOperations: [
      OperationType.FILE_READ, OperationType.FILE_WRITE, OperationType.FILE_RENAME,
    ],
    deniedOperations: [OperationType.SHELL_EXECUTE, OperationType.TERMINAL_INTERACTIVE, OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 60,
  },
  'general-assistant': {
    allowedOperations: [
      OperationType.FILE_READ, OperationType.FILE_WRITE,
      OperationType.SHELL_EXECUTE, OperationType.GIT_EXEC,
    ],
    deniedOperations: [OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 80,
    maxShellOperationsPerMinute: 40,
  },
  'store-diagnosis': {
    allowedOperations: [
      OperationType.FILE_READ,
      OperationType.SHELL_EXECUTE, OperationType.TERMINAL_INTERACTIVE,
    ],
    deniedOperations: [OperationType.FILE_WRITE, OperationType.FILE_DELETE, OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 40,
    maxShellOperationsPerMinute: 20,
  },
  'scenario-builder': {
    allowedOperations: [
      OperationType.FILE_READ, OperationType.FILE_WRITE, OperationType.FILE_RENAME,
      OperationType.SHELL_EXECUTE, OperationType.TERMINAL_INTERACTIVE, OperationType.GIT_EXEC,
    ],
    deniedOperations: [OperationType.SYSTEM_SHELL],
    maxFileOperationsPerMinute: 150,
    maxShellOperationsPerMinute: 80,
  },
}

function initBuiltinPolicies(): void {
  for (const [scenarioId, policy] of Object.entries(BUILTIN_SCENARIO_POLICIES)) {
    setScenarioPermissionPolicy({
      scenarioId,
      allowedOperations: policy.allowedOperations || [],
      deniedOperations: policy.deniedOperations || [],
      maxFileOperationsPerMinute: policy.maxFileOperationsPerMinute,
      maxShellOperationsPerMinute: policy.maxShellOperationsPerMinute,
      restrictedPaths: policy.restrictedPaths,
      allowedFileExtensions: policy.allowedFileExtensions,
    })
  }
  logger.security.info(`[Security] ${BRAND.name} builtin scenario policies initialized`)
}

initBuiltinPolicies()
