/**
 * 安全终端执行模块 — 受控的终端命令执行
 *
 * 职责：
 * - 替代原有 terminal.ts 中的高危功能
 * - 通过 securityManager 进行命令权限校验
 * - 支持 spawn / execFile / execSync 三种执行模式
 * - 支持交互式终端（pty 模式）
 *
 * 差异化特性（相比基础实现）：
 * - 命令白名单校验
 * - 场景权限策略集成
 * - Python 运行时集成（pythonManager）
 * - IPC 安全包装器集成（safeIpcHandle）
 * - 终端输入规范化（normalizePipeTerminalInput）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execSync, execFile, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
const execFileAsync = promisify(execFile)
import { EventEmitter } from 'events'
import { StringDecoder } from 'node:string_decoder'
import { securityManager, OperationType } from './securityPolicyEngine'
import {
  SECURITY_DEFAULTS,
  isProtectedAppDirDeletion,
  PROTECTED_APP_DIR_NAME,
} from '@shared/appConstants'
import { DANGEROUS_COMMAND_PATTERNS } from '@shared/configuration/dangerousCommands'
import { safeIpcHandle } from '../bridge/core/ipcGuard'
import { normalizePipeTerminalInput } from './terminalInputFilter'
export { normalizePipeTerminalInput }
import { pythonManager } from '../modules/python-runtime'
import { nodeManager } from '../modules/node-runtime'
import { gitCredentialStore, normalizeHost } from '../modules/git-credential/GitCredentialStore'
import { registerGitCredentialIpc } from '../modules/git-credential/GitCredentialIpc'
import {
  buildCredentialEnv,
  buildPromptlessEnv,
  detectAuthFailure,
  extractUrlFromArgs,
  requiresAuth,
} from '../modules/git-credential/GitAskpass'
import type { GitExecOptions, GitExecResponse } from '../modules/git-credential/types'


/**
 * 终端输出聚合节拍（ms）。
 *
 * 与 LLM 流式事件保持同一节奏：足够实时（人眼对 30ms 无感），
 * 又能把「每秒上百次小 chunk」压成每秒约 33 次 IPC。
 */
const TERMINAL_DATA_FLUSH_DELAY_MS = 30

/** 单批聚合的数据量上限（字符）：超过立即刷出，避免单条 IPC 过大或大输出被延迟 */
const TERMINAL_DATA_FLUSH_CHARS = 32 * 1024

interface SecureShellRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  requireConfirm?: boolean
}

interface CommandWhitelist {
  shell: Set<string>
  git: Set<string>
}

// 旧版白名单配置（保留以兼容已安装版本；shell 部分不再用于校验，仅 git 部分仍生效）
let WHITELIST: CommandWhitelist = {
  shell: new Set(SECURITY_DEFAULTS.SHELL_COMMANDS.map(cmd => cmd.toLowerCase())),
  git: new Set(SECURITY_DEFAULTS.GIT_SUBCOMMANDS.map(cmd => cmd.toLowerCase())),
}

// Shell 命令黑名单：命中即拒绝执行（AI 执行 Shell 命令时实际生效的拦截策略）
let BLACKLIST: Set<string> = new Set(
  SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS.map(cmd => cmd.toLowerCase())
)

// 更新白名单配置（保留以兼容旧调用方；shell 部分实际不再用于校验）
export function updateWhitelist(shellCommands: string[], gitCommands: string[]) {
  WHITELIST.shell = new Set(shellCommands.map(cmd => cmd.toLowerCase()))
  WHITELIST.git = new Set(gitCommands.map(cmd => cmd.toLowerCase()))
  logger.security.info('[Security] Whitelist updated:', {
    shell: Array.from(WHITELIST.shell),
    git: Array.from(WHITELIST.git)
  })
}

// 获取当前白名单
export function getWhitelist() {
  return {
    shell: Array.from(WHITELIST.shell),
    git: Array.from(WHITELIST.git)
  }
}

// 更新 Shell 命令黑名单
export function updateBlacklist(deniedShellCommands: string[]) {
  BLACKLIST = new Set(deniedShellCommands.map(cmd => cmd.toLowerCase()))
  logger.security.info('[Security] Shell blacklist updated:', {
    denied: Array.from(BLACKLIST)
  })
}

// 获取当前 Shell 命令黑名单
export function getBlacklist() {
  return {
    shell: Array.from(BLACKLIST),
  }
}

// Terminal instances storage (模块级别，便于清理)
const terminals = new Map<string, any>() // IPty instances
const backgroundProcesses = new Map<number, import('child_process').ChildProcess>() // shell:executeBackground 子进程

/**
 * 可靠地终止 PTY 进程树
 *
 * node-pty 的 ConPTY 模式在 Windows 上 kill() 存在异步竞态，
 * 可能导致 PowerShell/conhost 子进程残留。
 * 使用 taskkill /F /T 强制终止整个进程树。
 */
function killPtyReliably(ptyProcess: any): void {
  try {
    ptyProcess.removeAllListeners('exit')
    ptyProcess.removeAllListeners('data')
  } catch { /* ignore */ }

  const pid = ptyProcess.pid
  try {
    if (process.platform === 'win32' && pid) {
      // Windows: taskkill /F /T 强制杀死整个进程树（PowerShell + conhost）
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 })
    } else {
      ptyProcess.kill()
    }
  } catch {
    // taskkill 失败时 fallback 到 node-pty 原生 kill
    try { ptyProcess.kill() } catch { /* ignore */ }
  }
}

/**
 * 清理所有终端进程
 */
export function cleanupTerminals(): void {
  for (const [id, ptyProcess] of terminals) {
    killPtyReliably(ptyProcess)
    terminals.delete(id)
  }
  // 清理后台进程
  for (const [pid, child] of backgroundProcesses) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    backgroundProcesses.delete(pid)
  }
  logger.security.info(`[Terminal] All terminals and background processes cleaned up`)
}

// 危险命令模式列表（统一来源：@shared/configuration/dangerousCommands）
// 本地引用 shared 定义，主进程作为安全底线硬拦截，渲染进程审批门禁共用同一份模式
const DANGEROUS_PATTERNS = DANGEROUS_COMMAND_PATTERNS

// Shell 注入字符检测（用于 args 参数）
const SHELL_INJECTION_CHARS = /[;&|`$(){}<>]/

// Git 参数注入检测（仅检测真正危险的 shell 执行字符，允许 git ref 语法如 @{upstream}、HEAD~1）
const GIT_ARG_INJECTION_CHARS = /[;&|`$]/

/**
 * 检测单个参数是否包含 shell 注入字符
 */
function containsShellInjection(arg: string): boolean {
  return SHELL_INJECTION_CHARS.test(arg)
}

/**
 * 检测 git 参数是否包含注入字符（比通用检测更宽松，允许 {} <> () 用于 git ref）
 */
function containsGitArgInjection(arg: string): boolean {
  return GIT_ARG_INJECTION_CHARS.test(arg)
}

// 命令安全检查结果
interface SecurityCheckResult {
  safe: boolean
  reason?: string
  sanitizedCommand?: string
}

/**
   * 安全命令解析器
   */
  class SecureCommandParser {
    private static normalizeCommandForWhitelist(baseCommand: string): string {
      const normalized = path.basename(baseCommand).toLowerCase()
      if (process.platform === 'win32') {
        return normalized.replace(/\.(cmd|bat|exe)$/i, '')
      }
      return normalized
    }

    /**
     * 验证命令是否允许执行
     *
     * - type='shell': 黑名单校验，命中黑名单即拒绝；否则放行
     * - type='git':   白名单校验，未命中白名单即拒绝
     */
    static validateCommand(baseCommand: string, type: 'shell' | 'git'): SecurityCheckResult {
      const normalizedCommand = this.normalizeCommandForWhitelist(baseCommand)

      if (type === 'git') {
        const allowed = WHITELIST.git.has(normalizedCommand)
        return {
          safe: allowed,
          reason: allowed ? undefined : `Git子命令"${baseCommand}"不在白名单中`,
        }
      }

      // Shell 命令：黑名单校验
      const denied = BLACKLIST.has(normalizedCommand)
      return {
        safe: !denied,
        reason: denied ? `Shell命令"${baseCommand}"在黑名单中，禁止执行` : undefined,
      }
    }

  /**
   * 检测危险命令模式
   */
  static detectDangerousPatterns(command: string): SecurityCheckResult {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safe: false,
          reason: `检测到危险模式: ${pattern}`,
        }
      }
    }

    return { safe: true }
  }

  /**
   * 安全执行命令
   */
  static async executeSecureCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number,
    extraEnv?: Record<string, string>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      // 使用 spawn 直接执行（不经过 shell），防止注入攻击
      const child = spawn(command, args, {
        cwd,
        timeout,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          // 凭证类变量（GIT_ASKPASS / AWEE_GIT_* ）由 git 通道注入，
          // 只有显式传入时才覆盖，默认行为不变
          ...(extraEnv || {}),
        },
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 })
      })

      child.on('error', (err) => {
        reject(err)
      })
    })
  }
}

/**
 * 解析仓库 remote 的主机名（用于匹配已存凭证）
 *
 * 优先级：origin → 第一个 remote。解析失败返回空串，调用方降级为「无凭证」路径
 * （此时若系统已配置 keychain helper，push 依然可以成功）。
 */
async function resolveRepoRemoteHost(cwd: string): Promise<string> {
  try {
    const { GitProcess } = require('dugite')
    const origin = await GitProcess.exec(['remote', 'get-url', 'origin'], cwd)
    const originUrl = origin.exitCode === 0 ? origin.stdout.trim() : ''
    if (originUrl) return normalizeHost(originUrl)

    const list = await GitProcess.exec(['remote'], cwd)
    if (list.exitCode === 0) {
      const firstRemote = list.stdout.split('\n').map((line: string) => line.trim()).filter(Boolean)[0]
      if (firstRemote) {
        const remote = await GitProcess.exec(['remote', 'get-url', firstRemote], cwd)
        if (remote.exitCode === 0) return normalizeHost(remote.stdout.trim())
      }
    }
  } catch {
    // 非 git 仓库 / dugite 不可用 → 无 host，走无凭证路径
  }
  return ''
}

/**
 * 注册安全的终端处理程序
 */
export function registerSecureTerminalHandlers(
  getMainWindow: () => BrowserWindow | null,
  getWorkspace: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  getWindowWorkspace?: (windowId: number) => string[] | null
) {
  /**
   * 安全的命令执行（白名单 + 工作区边界）
   * 替代原来的 shell:execute
   */
  safeIpcHandle('shell:executeSecure', async (
    event,
    request: SecureShellRequest
  ): Promise<{
    success: boolean
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
  }> => {
    // timeout = 0 表示不限制超时，AI 执行命令不受时间限制
    const { command, args = [], cwd, timeout = 0, requireConfirm = true } = request
    const mainWindow = getMainWindow()
    const workspace = getWorkspace(event)

    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' }
    }

    // 1. 工作区检查（支持无工作区模式）
    let targetPath: string
    if (workspace) {
      targetPath = cwd || workspace.roots[0]
      if (!securityManager.validateWorkspacePath(targetPath, workspace.roots)) {
        securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
          reason: '路径在工作区外',
          targetPath,
          workspace: workspace.roots,
        })
        return { success: false, error: '不允许在工作区外执行命令' }
      }
    } else {
      // 无工作区模式：使用 cwd 或当前进程工作目录
      targetPath = cwd || process.cwd()
      logger.security.info(`[Security] No workspace set, using: ${targetPath}`)
    }

    // 2. 检测危险模式
    const fullCommand = [command, ...args].join(' ')
    const dangerousCheck = SecureCommandParser.detectDangerousPatterns(fullCommand)
    if (!dangerousCheck.safe) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        reason: dangerousCheck.reason,
      })
      return { success: false, error: dangerousCheck.reason }
    }

    // 2.5 受保护应用数据目录（.aweeclaw）删除拦截 —— 静默拒绝，不弹窗
    if (isProtectedAppDirDeletion(fullCommand)) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        reason: '安全底线：禁止删除工作区系统目录 (.aweeclaw)，已静默拒绝',
      })
      return {
        success: false,
        error: `Refused: "${PROTECTED_APP_DIR_NAME}" is a protected system directory and cannot be deleted.`,
      }
    }

    // 3. 黑名单验证（Shell 命令采用黑名单策略：命中即拒绝）
    const baseCommand = command.toLowerCase()
    const blacklistCheck = SecureCommandParser.validateCommand(baseCommand, 'shell')
    if (!blacklistCheck.safe) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        reason: blacklistCheck.reason,
      })
      return { success: false, error: blacklistCheck.reason }
    }

    // 3.5. args 注入字符检测（防止通过参数注入 shell 特殊字符）
    const injectedArg = args.find(containsShellInjection)
    if (injectedArg) {
      const reason = `参数包含危险字符: "${injectedArg}"`
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, { reason })
      return { success: false, error: reason }
    }

    // 4. 权限检查（用户确认）
    if (requireConfirm) {
      const hasPermission = await securityManager.checkPermission(
        OperationType.SHELL_EXECUTE,
        fullCommand
      )

      if (!hasPermission) {
        securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
          reason: '用户拒绝',
        })
        return { success: false, error: '用户拒绝执行命令' }
      }
    }

    try {
      // 5. 安全执行命令
      const result = await SecureCommandParser.executeSecureCommand(
        command,
        args,
        targetPath,
        timeout
      )

      // 6. 记录审计日志
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, true, {
        exitCode: result.exitCode,
        outputLength: result.stdout.length,
        errorLength: result.stderr.length,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        errorOutput: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (err) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        error: toAppError(err).message,
      })
      return {
        success: false,
        error: `执行失败: ${toAppError(err).message}`,
      }
    }
  })

  /**
   * 安全的 Git 命令执行
   * 替代原来的 git:exec（移除 exec 拼接）
   *
   * 凭证能力（第 4 个参数 options）：
   * - 网络命令（push/pull/fetch/clone/ls-remote）自动注入已存凭证（askpass 方式）
   * - 认证失败时返回 `authRequired: true` + `authHost`，渲染层据此弹出账号密码输入框
   * - `options.credential` 可携带用户在弹窗中一次性输入的凭证
   */
  safeIpcHandle('git:execSecure', async (
    event,
    args: string[],
    cwd: string,
    options?: GitExecOptions
  ): Promise<GitExecResponse> => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    const windowId = event.sender.id
    const windowRoots = getWindowWorkspace?.(windowId)
    const workspace = windowRoots ? { roots: windowRoots } : getWorkspace()

    // 调试日志：记录 workspace 状态
    logger.security.debug('[Git] Workspace check:', {
      windowId,
      windowRoots: windowRoots || 'null',
      workspaceFromStore: workspace?.roots || 'null',
      cwd,
    })

    // 1. 工作区检查（允许无工作区模式以支持新窗口）
    if (!workspace || workspace.roots.length === 0) {
      // 无工作区时信任传入的cwd路径
      logger.security.info('[Git] No workspace set, trusting cwd:', cwd)
    } else {
      // 2. 验证工作区边界
      if (!securityManager.validateWorkspacePath(cwd, workspace.roots)) {
        logger.security.warn('[Git] Path validation failed:', { cwd, roots: workspace.roots })
        securityManager.logOperation(OperationType.GIT_EXEC, args.join(' '), false, {
          reason: '路径在工作区外',
          cwd,
          workspace: workspace.roots,
        })
        return { success: false, error: '不允许在工作区外执行Git命令' }
      }
    }

    // 2. Git 子命令白名单验证
    if (args.length === 0) {
      return { success: false, error: '缺少Git命令' }
    }

    // 跳过全局选项探测真正的子命令
    let cmdIdx = 0
    while (cmdIdx < args.length && args[cmdIdx].startsWith('-')) {
      if (args[cmdIdx] === '-c' || args[cmdIdx] === '-C') {
        cmdIdx += 2
      } else {
        cmdIdx += 1
      }
    }
    if (cmdIdx >= args.length) {
      return { success: false, error: '未找到Git子命令' }
    }

    const gitSubCommand = args[cmdIdx].toLowerCase()
    const whitelistCheck = SecureCommandParser.validateCommand(gitSubCommand, 'git')

    if (!whitelistCheck.safe) {
      securityManager.logOperation(OperationType.GIT_EXEC, args.join(' '), false, {
        reason: whitelistCheck.reason,
      })
      return { success: false, error: whitelistCheck.reason }
    }

    // 3. 检测危险模式（防止参数注入）
    const fullCommand = args.join(' ')
    const dangerousCheck = SecureCommandParser.detectDangerousPatterns(fullCommand)
    if (!dangerousCheck.safe) {
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
        reason: dangerousCheck.reason,
      })
      return { success: false, error: dangerousCheck.reason }
    }

    // 3.5. args 注入字符检测（git 使用宽松规则，允许 @{upstream} 等 ref 语法）
    const injectedArg = args.find(containsGitArgInjection)
    if (injectedArg) {
      const reason = `参数包含危险字符: "${injectedArg}"`
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, { reason })
      return { success: false, error: reason }
    }

    // 4. 权限检查
    const hasPermission = await securityManager.checkPermission(
      OperationType.GIT_EXEC,
      `git ${fullCommand}`
    )

    if (!hasPermission) {
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
        reason: '用户拒绝',
      })
      return { success: false, error: '用户拒绝执行Git命令' }
    }

    // ── 凭证解析与注入 ──────────────────────────────────────
    // 只对「可能触发认证」的子命令做处理，本地命令零开销、行为与改造前完全一致。
    const execOptions: GitExecOptions = options || {}
    const needsAuth = requiresAuth(args)
    let credentialEnv: Record<string, string> = buildPromptlessEnv()
    let credentialGlobalArgs: string[] = []
    let authHost = execOptions.credential?.host
      ? normalizeHost(execOptions.credential.host)
      : ''

    if (needsAuth) {
      // host 解析优先级：显式传入 → 参数中的 URL（clone/ls-remote）→ 仓库 remote origin
      if (!authHost) {
        authHost = normalizeHost(extractUrlFromArgs(args) || '')
      }
      if (!authHost) {
        authHost = await resolveRepoRemoteHost(cwd)
      }

      let resolvedCredential: { username: string; secret: string } | null = null
      if (execOptions.credential?.username) {
        // 用户在凭证弹窗中一次性输入的凭证（优先于已存凭证）
        resolvedCredential = {
          username: execOptions.credential.username,
          secret: execOptions.credential.secret || '',
        }
      } else if (execOptions.credential?.useStored !== false && authHost) {
        resolvedCredential = gitCredentialStore.resolve(authHost)
      }

      if (resolvedCredential?.username) {
        const built = buildCredentialEnv(gitCredentialStore.getDataDir(), resolvedCredential)
        if (built) {
          credentialEnv = { ...credentialEnv, ...built.env }
          credentialGlobalArgs = built.globalArgs
        }
      }
    }

    const execArgs = credentialGlobalArgs.length > 0 ? [...credentialGlobalArgs, ...args] : args

    try {
      // 使用 dugite（安全）
      const { GitProcess } = require('dugite')
      const result = await GitProcess.exec(execArgs, cwd, { env: credentialEnv })

      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
        exitCode: result.exitCode,
      })

      if (result.exitCode !== 0) {
        // 认证失败识别：把「缺少凭证」与真正的执行失败区分开，
        // 前者返回 authRequired 让渲染层弹窗，而不是把 git 的英文报错直接抛给用户。
        const failure = detectAuthFailure(result.stderr, result.stdout)
        if (failure.authRequired) {
          logger.security.info('[Git] Authentication required:', {
            args,
            host: failure.host || authHost,
            hasStoredCredential: authHost ? gitCredentialStore.has(authHost) : false,
          })
          return {
            success: false,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            authRequired: true,
            authHost: failure.host || authHost || undefined,
            authHint: failure.tokenRequired ? 'token-required' : 'credential-required',
          }
        }

        // 查询型命令（rev-parse --verify, status 等）exitCode 非零是正常的，不应记为 error
        const isQueryCommand = args.some(a => a === '--verify' || a === '--is-inside-work-tree')
        if (isQueryCommand) {
          logger.security.debug('[Git] dugite query returned non-zero:', args)
        } else {
          logger.security.error('[Git] dugite exec failed:', args, result.stderr || result.stdout)
        }
      }

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error) {
      logger.security.warn('[Git] dugite 不可用，尝试安全的 spawn 方式')

      try {
        // 6. 安全回退：使用 spawn 而非 exec
        const result = await SecureCommandParser.executeSecureCommand(
          'git',
          execArgs,
          cwd,
          120000,
          credentialEnv,
        )

        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
          exitCode: result.exitCode,
        })

        if (result.exitCode !== 0) {
          const failure = detectAuthFailure(result.stderr, result.stdout)
          if (failure.authRequired) {
            return {
              success: false,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              authRequired: true,
              authHost: failure.host || authHost || undefined,
              authHint: failure.tokenRequired ? 'token-required' : 'credential-required',
            }
          }

          const isQueryCommand = args.some(a => a === '--verify' || a === '--is-inside-work-tree')
          if (isQueryCommand) {
            logger.security.debug('[Git] spawn query returned non-zero:', args)
          } else {
            logger.security.error('[Git] spawn exec failed:', args, result.stderr || result.stdout)
          }
        }

        return {
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }
      } catch (err) {
        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
          error: toAppError(err).message,
        })
        return {
          success: false,
          error: `Git执行失败: ${toAppError(err).message}`,
        }
      }
    }
  })

  // Git 凭证管理通道（与 git:execSecure 同域注册，内部自带幂等保护）
  registerGitCredentialIpc()

  // ============ Interactive Terminal with node-pty ============

  const MAX_TERMINALS = 10 // 最大终端数量限制
  let pty: any = null

  // Try to load node-pty
  try {
    pty = require('node-pty')

    // 确保 spawn-helper 有执行权限（npm install 可能丢失权限）
    try {
      const fsModule = require('fs')
      const ptyModuleDir = path.dirname(require.resolve('node-pty/package.json'))
      const platformDir = `${process.platform}-${process.arch}`
      const spawnHelperPath = path.join(ptyModuleDir, 'prebuilds', platformDir, 'spawn-helper')
      try {
        fsModule.accessSync(spawnHelperPath, fsModule.constants.X_OK)
      } catch {
        fsModule.chmodSync(spawnHelperPath, 0o755)
        logger.security.info('[Terminal] Fixed spawn-helper execute permission:', spawnHelperPath)
      }
    } catch (chmodErr) {
      logger.security.warn('[Terminal] Could not verify/fix spawn-helper permission:', chmodErr)
    }

    // 验证 node-pty 是否可用
    try {
      // 只验证模块加载，不实际创建进程
      if (typeof pty.spawn !== 'function') {
        throw new Error('node-pty.spawn is not a function')
      }
      logger.security.info('[Terminal] node-pty loaded and verified successfully')
    } catch (err) {
      logger.security.error('[Terminal] node-pty verification failed:', err)
      logger.security.error('[Terminal] This usually means node-pty needs to be rebuilt for Electron.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
      pty = null
    }
  } catch (err) {
    const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown error'
    logger.security.warn('[Terminal] node-pty not available, interactive terminal disabled')
    logger.security.warn('[Terminal] Error:', errorMsg)

    // 检查是否是原生模块加载错误
    if (errorMsg.includes('Cannot find module') || errorMsg.includes('module') || errorMsg.includes('native')) {
      logger.security.error('[Terminal] node-pty native module may need to be rebuilt.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
    }

    pty = null
  }

  type TerminalBackend = 'pty' | 'pipe'

  class PipeShellSession extends EventEmitter {
    private readonly stdoutUtf8 = new StringDecoder('utf8')
    private readonly stderrUtf8 = new StringDecoder('utf8')

    constructor(private readonly child: ChildProcessWithoutNullStreams) {
      super()

      this.child.stdout.on('data', (data: Buffer) => {
        const text = this.stdoutUtf8.write(data)
        if (text.length > 0) {
          this.emit('data', text)
        }
      })

      this.child.stderr.on('data', (data: Buffer) => {
        const text = this.stderrUtf8.write(data)
        if (text.length > 0) {
          this.emit('data', text)
        }
      })

      this.child.on('error', (err) => {
        this.emit('error', err)
      })

      this.child.on('close', (code) => {
        const tailOut = this.stdoutUtf8.end()
        const tailErr = this.stderrUtf8.end()
        if (tailOut.length > 0) {
          this.emit('data', tailOut)
        }
        if (tailErr.length > 0) {
          this.emit('data', tailErr)
        }
        this.emit('exit', { exitCode: code ?? 0 })
      })
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (data === String.fromCharCode(3)) {
        this.kill('SIGINT')
        return
      }

      if (!this.child.stdin.destroyed) {
        this.child.stdin.write(normalizePipeTerminalInput(data))
      }
    }

    resize(_cols: number, _rows: number) {
      // Pipe-backed sessions do not support PTY resizing.
    }

    kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (this.child.killed) {
        return
      }

      if (process.platform !== 'win32' && this.child.pid) {
        try {
          process.kill(-this.child.pid, signal)
          return
        } catch {
          // Fall back to killing the shell process directly.
        }
      }

      this.child.kill(signal)
    }
  }

  let ssh2ClientCtor: any = null

  const getSsh2ClientCtor = () => {
    if (ssh2ClientCtor) return ssh2ClientCtor

    try {
      const cpuFeaturesPath = require.resolve('cpu-features')
      require.cache[cpuFeaturesPath] = {
        id: cpuFeaturesPath,
        filename: cpuFeaturesPath,
        loaded: true,
        exports: () => null,
        children: [],
        paths: [],
      } as unknown as NodeJS.Module
    } catch {
    }

    ssh2ClientCtor = require('ssh2').Client
    return ssh2ClientCtor
  }

  class SshShellSession extends EventEmitter {
    private connection: any
    private stream: any
    private closed = false
    private cols: number
    private rows: number
    private readonly streamUtf8 = new StringDecoder('utf8')

    constructor(private readonly server: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string }, cols = 80, rows = 24) {
      super()
      this.cols = cols
      this.rows = rows
      this.connection = null
      this.stream = null
    }

    async connect(): Promise<void> {
      const Client = getSsh2ClientCtor()
      this.connection = new Client()

      const config: Record<string, unknown> = {
        host: this.server.host.trim(),
        port: this.server.port && this.server.port > 0 ? this.server.port : 22,
        username: this.server.username?.trim() || 'root',
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        tryKeyboard: Boolean(this.server.password),
      }

      if (this.server.privateKeyPath?.trim()) {
        config.privateKey = require('fs').readFileSync(this.server.privateKeyPath.trim(), 'utf8')
      }
      if (this.server.password?.trim()) {
        config.password = this.server.password
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finishReject = (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
        }

        this.connection
          .on('ready', () => {
            this.connection.shell({ term: 'xterm-256color', cols: this.cols, rows: this.rows }, (error: Error | undefined, stream: any) => {
              if (error || !stream) {
                finishReject(error || new Error('Failed to open remote shell'))
                return
              }

              this.stream = stream
              stream.on('data', (data: Buffer | string) => {
                if (typeof data === 'string') {
                  this.emit('data', data)
                  return
                }
                const text = this.streamUtf8.write(data)
                if (text.length > 0) {
                  this.emit('data', text)
                }
              })
              stream.on('close', () => {
                if (this.closed) return
                this.closed = true
                const tail = this.streamUtf8.end()
                if (tail.length > 0) {
                  this.emit('data', tail)
                }
                this.emit('exit', { exitCode: 0 })
                this.connection.end()
              })
              stream.on('error', (err: unknown) => this.emit('error', err))

              if (this.server.remotePath?.trim()) {
                const escaped = this.server.remotePath.trim().replace(/'/g, `'\''`)
                stream.write(`cd '${escaped}'\n`)
              }

              if (!settled) {
                settled = true
                resolve()
              }
            })
          })
          .on('keyboard-interactive', (_name: string, _instructions: string, _lang: string, _prompts: Array<unknown>, finish: (responses: string[]) => void) => {
            finish([this.server.password || ''])
          })
          .on('error', (error: unknown) => {
            this.emit('error', error)
            finishReject(error)
          })
          .on('close', () => {
            if (this.closed) return
            this.closed = true
            const tail = this.streamUtf8.end()
            if (tail.length > 0) {
              this.emit('data', tail)
            }
            this.emit('exit', { exitCode: 0 })
          })
          .connect(config as any)
      })
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (this.stream) {
        this.stream.write(data)
      }
    }

    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      try {
        this.stream?.setWindow(rows, cols, 0, 0)
      } catch {
      }
    }

    kill() {
      if (this.closed) return
      this.closed = true
      const tail = this.streamUtf8.end()
      if (tail.length > 0) {
        this.emit('data', tail)
      }
      try {
        this.stream?.end('exit\n')
      } catch {
      }
      try {
        this.connection?.end()
      } catch {
      }
      this.emit('exit', { exitCode: 0 })
    }
  }

  const bindTerminalProcess = (id: string, terminalProcess: any, mainWindow: BrowserWindow | null) => {
    terminals.set(id, terminalProcess)
    let seq = 0
    const ptyUtf8 = new StringDecoder('utf8')

    const nextMeta = () => ({
      seq: ++seq,
      occurredAt: Date.now(),
    })

    /**
     * 输出聚合缓冲。
     *
     * PTY 的 onData 回调粒度很小（几十到几百字节），`npm install` 这类命令
     * 每秒能触发上百次 —— 逐次 IPC 会让主进程与渲染进程都忙于
     * 序列化 / 结构化克隆 / 订阅者分发，是 AI 执行命令期间的主要 CPU 开销之一。
     * 这里按固定节拍合并成一批发送（与 LLM 流式事件保持同一节奏）。
     */
    let pendingText = ''
    let pendingTimer: ReturnType<typeof setTimeout> | null = null

    const flushTerminalData = (): void => {
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      if (pendingText.length === 0) return
      const text = pendingText
      pendingText = ''
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', { id, data: text, ...nextMeta() })
      }
    }

    const queueTerminalData = (text: string): void => {
      pendingText += text
      // 单批过大立即刷出：既限制单条 IPC 的体积，也保证大输出不会被积压
      if (pendingText.length >= TERMINAL_DATA_FLUSH_CHARS) {
        flushTerminalData()
        return
      }
      // 固定节拍（throttle）而非重新计时：输出持续不断时也要按节奏下发
      if (pendingTimer) return
      pendingTimer = setTimeout(flushTerminalData, TERMINAL_DATA_FLUSH_DELAY_MS)
    }

    terminalProcess.onData((data: string | Buffer) => {
      const text = typeof data === 'string' ? data : ptyUtf8.write(data)
      if (text.length === 0) {
        return
      }
      queueTerminalData(text)
    })

    terminalProcess.on('error', (err: any) => {
      logger.security.error(`[Terminal] PTY Error (id: ${id}):`, err)
      // 出错也先把已收到的输出刷出去，避免最后一段丢失
      flushTerminalData()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:error', {
          id,
          error: toAppError(err).message,
          fatal: true,
          reason: 'process_error',
          ...nextMeta(),
        })
      }
    })

    terminalProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      logger.security.info(`[Terminal] Terminal ${id} exited with code ${exitCode}, signal ${signal}`)
      terminals.delete(id)
      // 先把聚合缓冲里的输出刷出去，保证渲染层看到的顺序是「输出 → 退出」
      flushTerminalData()
      const tail = ptyUtf8.end()
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (tail.length > 0) {
          mainWindow.webContents.send('terminal:data', { id, data: tail, ...nextMeta() })
        }
        mainWindow.webContents.send('terminal:exit', {
          id,
          exitCode,
          signal,
          reason: 'process_exit',
          ...nextMeta(),
        })
      }
    })
  }

  /**
   * 交互式终端创建（默认 node-pty；渲染进程为 Agent 终端传入 pipe 时可退回 pipe 会话）
   */
  safeIpcHandle('terminal:interactive', async (
    event,
    options: { id: string; cwd?: string; shell?: string; backend?: TerminalBackend; remote?: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string } }
  ) => {
    const mainWindow = getMainWindow()
    const workspace = getWorkspace(event)
    const { id, cwd, shell, backend = 'pty', remote } = options
    const effectiveBackend: TerminalBackend = backend

    if (effectiveBackend === 'pty' && !pty) {
      return { success: false, error: 'node-pty not available' }
    }

    if (terminals.size >= MAX_TERMINALS && !terminals.has(id)) {
      return { success: false, error: `Maximum number of terminals (${MAX_TERMINALS}) reached` }
    }

    const targetCwd = (cwd && cwd.trim()) || workspace?.roots?.[0] || process.cwd()

    if (workspace && workspace.roots.length > 0 && !remote?.host && !securityManager.validateWorkspacePath(targetCwd, workspace.roots)) {
      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', false, {
        reason: '路径在工作区外',
        cwd: targetCwd,
      })
      return { success: false, error: '终端只能在工作区内创建' }
    }

    try {
      const isWindows = process.platform === 'win32'
      const isMac = process.platform === 'darwin'

      let shellPath: string
      let shellArgs: string[] = []

      if (shell) {
        shellPath = shell
      } else if (isWindows) {
        shellPath = 'powershell.exe'
      } else if (isMac) {
        const fs = require('fs')
        const possibleShells = [
          process.env.SHELL,
          '/bin/zsh',
          '/bin/bash',
          '/usr/bin/zsh',
          '/usr/bin/bash',
        ].filter(Boolean) as string[]

        shellPath = possibleShells.find(s => {
          try {
            return fs.existsSync(s)
          } catch {
            return false
          }
        }) || '/bin/bash'

        logger.security.info(`[Terminal] Using shell: ${shellPath}`)
        shellArgs = effectiveBackend === 'pipe' ? ['-il'] : ['-l']
      } else {
        shellPath = process.env.SHELL || '/bin/bash'
      }

      logger.security.info(`[Terminal] Spawning ${effectiveBackend.toUpperCase()} terminal: ${shellPath} ${shellArgs.join(' ')} in ${targetCwd}`)

      const fs = require('fs')
      const pathModule = require('path')

      const pythonStatus = pythonManager.status
      const venvBinDir = pythonStatus.venvDir
        ? path.join(pythonStatus.venvDir, process.platform === 'win32' ? 'Scripts' : 'bin')
        : null
      const nodeBinDir = nodeManager.getBinDir()
      const terminalEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }
      // 构建增强 PATH：将 venv 和 node bin 目录前置注入
      const pathPrefix: string[] = []
      if (venvBinDir && fs.existsSync(venvBinDir)) {
        pathPrefix.push(venvBinDir)
        logger.security.info(`[Terminal] Injected venv bin into PATH: ${venvBinDir}`)
      }
      if (nodeBinDir && fs.existsSync(nodeBinDir)) {
        pathPrefix.push(nodeBinDir)
        logger.security.info(`[Terminal] Injected Node.js bin into PATH: ${nodeBinDir}`)
      }
      if (pathPrefix.length > 0) {
        terminalEnv.PATH = `${pathPrefix.join(path.delimiter)}${path.delimiter}${process.env.PATH}`
      }

      if (pathModule.isAbsolute(shellPath) && !fs.existsSync(shellPath)) {
        const error = `Shell not found: ${shellPath}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      if (!fs.existsSync(targetCwd)) {
        const error = `Working directory not found: ${targetCwd}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      let terminalProcess: any

      if (remote?.host) {
        try {
          const session = new SshShellSession(remote)
          await session.connect()
          terminalProcess = session
        } catch (err) {
          const errorMsg = toAppError(err).message || 'Failed to connect remote shell'
          logger.security.error(`[Terminal] Remote SSH spawn failed: ${errorMsg}`, err)
          return { success: false, error: `Failed to connect remote shell: ${errorMsg}` }
        }
      } else if (effectiveBackend === 'pipe') {
        const child = spawn(shellPath, shellArgs, {
          cwd: targetCwd,
          env: terminalEnv,
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          windowsHide: true,
        }) as ChildProcessWithoutNullStreams

        terminalProcess = new PipeShellSession(child)
      } else {
        try {
          await new Promise<void>((resolve, reject) => {
            setImmediate(() => {
              try {
                terminalProcess = pty.spawn(shellPath, shellArgs, {
                  name: 'xterm-256color',
                  // 默认 120 cols（而非 80），匹配大多数终端容器的实际宽度
                  // AI 执行命令时终端面板可能未显示，PTY 按此宽度处理回显和换行
                  // 用户后续打开终端时 xterm fit 会修正到实际 cols，120 接近常见值可减少排版差异
                  cols: 120,
                  rows: 24,
                  cwd: targetCwd,
                  env: terminalEnv,
                })

                if (!terminalProcess) {
                  reject(new Error('PTY process is null after spawn'))
                  return
                }

                resolve()
              } catch (err) {
                reject(err)
              }
            })
          })
        } catch (err) {
          const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown spawn error'
          logger.security.error(`[Terminal] PTY spawn failed: ${errorMsg}`, err)

          if (errorMsg.includes('Napi::Error') || errorMsg.includes('native') || errorMsg.includes('module') || errorMsg.includes('libc++abi')) {
            logger.security.warn('[Terminal] Falling back to pipe backend due to PTY error')
            const child = spawn(shellPath, ['-il'], {
              cwd: targetCwd,
              env: terminalEnv,
              stdio: 'pipe',
              detached: process.platform !== 'win32',
              windowsHide: true,
            }) as ChildProcessWithoutNullStreams

            terminalProcess = new PipeShellSession(child)
          } else {
            return { success: false, error: `Failed to spawn terminal: ${errorMsg}` }
          }
        }
      }

      bindTerminalProcess(id, terminalProcess, mainWindow)

      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', true, {
        id,
        cwd: targetCwd,
        shell: shellPath,
        backend: remote?.host ? 'ssh2' : effectiveBackend,
        remoteHost: remote?.host,
      })

      logger.security.info(`[Terminal] Created ${remote?.host ? 'ssh2' : effectiveBackend} terminal ${id} with shell ${shellPath}`)
      return { success: true }
    } catch (err) {
      logger.security.error('[Terminal] Failed to create terminal:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  /**
   * 获取可用 shell 列表（通过命令检测）
   */
  safeIpcHandle('shell:getAvailableShells', async () => {
    const shells: { label: string; path: string }[] = []
    const isWindows = process.platform === 'win32'
    const fs = require('fs')
    const pathModule = require('path')

    // 异步检查命令是否可执行
    const canExecute = async (cmd: string): Promise<boolean> => {
      try {
        await execFileAsync(cmd, ['--version'], {
          encoding: 'utf-8',
          timeout: 3000,
          windowsHide: true,
        })
        return true
      } catch {
        return false
      }
    }

    if (isWindows) {
      // PowerShell (always available)
      shells.push({ label: 'PowerShell', path: 'powershell.exe' })

      // Command Prompt (always available)
      shells.push({ label: 'Command Prompt', path: 'cmd.exe' })

      // Git Bash - 通过 git --exec-path 动态获取
      try {
        const { stdout } = await execFileAsync('git', ['--exec-path'], {
          encoding: 'utf-8',
          windowsHide: true,
        })
        const gitExecPath = stdout.trim()
        if (gitExecPath) {
          const gitRoot = pathModule.resolve(gitExecPath, '..', '..', '..')
          const bashPath = pathModule.join(gitRoot, 'bin', 'bash.exe')
          if (fs.existsSync(bashPath)) {
            shells.push({ label: 'Git Bash', path: bashPath })
          }
        }
      } catch {
        // Git 不可用
      }

      // 并行检测 WSL 和 PowerShell Core
      const [hasWsl, hasPwsh] = await Promise.all([canExecute('wsl'), canExecute('pwsh')])
      if (hasWsl) shells.push({ label: 'WSL', path: 'wsl.exe' })
      if (hasPwsh) shells.push({ label: 'PowerShell Core', path: 'pwsh.exe' })
    } else {
      // Unix: detect common shells (并行检测)
      const unixShells = ['bash', 'zsh', 'fish']
      const results = await Promise.all(unixShells.map(async (sh) => {
        try {
          const { stdout } = await execFileAsync('which', [sh], {
            encoding: 'utf-8',
            windowsHide: true,
          })
          const path = stdout.trim()
          if (path) return { label: sh.charAt(0).toUpperCase() + sh.slice(1), path }
        } catch { /* not found */ }
        return null
      }))
      for (const result of results) {
        if (result) shells.push(result)
      }
    }

    logger.security.info('[Terminal] Available shells:', shells.map(s => s.label).join(', '))
    return shells
  })

  /**
   * Write input to terminal
   */
  safeIpcHandle('terminal:input', async (_, { id, data }: { id: string; data: string }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.write(data)

        // 对于 Ctrl+C，添加日志以便调试
        if (data === '\x03' || data === String.fromCharCode(3)) {
          logger.security.debug(`[Terminal] Ctrl+C sent to terminal ${id}`)
        }
      } catch (err) {
        logger.security.error(`[Terminal] Write error (id: ${id}):`, err)
      }
    }
  })

  /**
   * 后台执行命令（Agent 专用）
   * 使用 child_process.spawn，不依赖 PTY
   * 实时推送输出到前端，精确捕获 exit code
   */
  safeIpcHandle('shell:executeBackground', async (
    event,
    { command, cwd, timeout = 30000, shell: customShell }: {
      command: string
      cwd?: string
      timeout?: number
      shell?: string
    }
  ): Promise<{ success: boolean; output: string; exitCode: number; error?: string }> => {
    const mainWindow = getMainWindow()
    const workspace = getWorkspace(event)
    const workingDir = cwd || workspace?.roots[0] || process.cwd()

    // 验证工作目录
    if (workspace && !securityManager.validateWorkspacePath(workingDir, workspace.roots)) {
      return { success: false, output: '', exitCode: 1, error: 'Working directory outside workspace' }
    }

    // 安全检查：检测危险模式
    const dangerousCheck = SecureCommandParser.detectDangerousPatterns(command)
    if (!dangerousCheck.safe) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
        reason: dangerousCheck.reason,
        source: 'executeBackground',
      })
      return { success: false, output: '', exitCode: 1, error: dangerousCheck.reason }
    }

    // 安全检查：受保护应用数据目录（.aweeclaw）删除拦截 —— 静默拒绝，不弹窗
    if (isProtectedAppDirDeletion(command)) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
        reason: '安全底线：禁止删除工作区系统目录 (.aweeclaw)，已静默拒绝',
        source: 'executeBackground',
      })
      return {
        success: false,
        output: '',
        exitCode: 1,
        error: `Refused: "${PROTECTED_APP_DIR_NAME}" is a protected system directory and cannot be deleted.`,
      }
    }

    // 安全检查：检测 shell 注入
    if (containsShellInjection(command)) {
      const reason = `命令包含危险字符: "${command}"`
      securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
        reason,
        source: 'executeBackground',
      })
      return { success: false, output: '', exitCode: 1, error: reason }
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32'
      const shell = customShell || (isWindows ? 'powershell.exe' : '/bin/bash')
      const shellArgs = isWindows
        ? ['-NoProfile', '-NoLogo', '-Command', command]
        : ['-c', command]

      logger.security.info(`[Shell] Executing: ${command} in ${workingDir}`)

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env, TERM: 'dumb' },
        windowsHide: true,
      })

      // 追踪后台进程，以便应用退出时清理
      if (child.pid) backgroundProcesses.set(child.pid, child)

      let stdout = ''
      let stderr = ''
      let timedOut = false

      // 超时处理
      const timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Windows 上 SIGTERM 可能不够，延迟后强制 kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 1000)
      }, timeout)

      // 实时推送输出
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stdout',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stderr',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId)
        if (child.pid) backgroundProcesses.delete(child.pid)

        // 清理输出（移除 ANSI 序列）
        const cleanOutput = (stdout + (stderr ? `\n${stderr}` : ''))
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\r\n/g, '\n')
          .trim()

        logger.security.info(`[Shell] Command finished: exit=${code}, signal=${signal}`)

        if (timedOut) {
          resolve({
            success: false,
            output: cleanOutput || `Command timed out after ${timeout / 1000}s`,
            exitCode: code ?? 124, // 124 是 timeout 的标准退出码
            error: `Command timed out after ${timeout / 1000}s`
          })
        } else {
          resolve({
            success: code === 0,
            output: cleanOutput,
            exitCode: code ?? 0,
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        if (child.pid) backgroundProcesses.delete(child.pid)
        logger.security.error(`[Shell] Command error:`, err)
        resolve({
          success: false,
          output: stdout + stderr,
          exitCode: 1,
          error: toAppError(err).message
        })
      })
    })
  })

  /**
   * Resize terminal
   */
  safeIpcHandle('terminal:resize', async (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows)
      } catch (e) {
        // Ignore resize errors
      }
    }
  })

  /**
   * Kill terminal
   */
  ipcMain.on('terminal:kill', (_, id?: string) => {
    if (id) {
      const ptyProcess = terminals.get(id)
      if (ptyProcess) {
        killPtyReliably(ptyProcess)
        terminals.delete(id)
      }
    } else {
      // Kill all terminals
      for (const [termId, ptyProcess] of terminals) {
        killPtyReliably(ptyProcess)
        terminals.delete(termId)
      }
    }
  })
}
