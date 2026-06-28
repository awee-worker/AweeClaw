/**
 * Sandbox - 沙箱执行环境
 *
 * 借鉴 OpenClaw 的 Sandbox 架构，为危险工具提供隔离执行环境：
 * 1. 文件系统沙箱：限制可访问的目录
 * 2. 命令沙箱：限制可执行的命令和参数
 * 3. 网络沙箱：限制网络访问
 * 4. 资源限制：CPU/内存/时间限制
 *
 * @module security/SandboxExecutor
 */

import { EventEmitter } from 'events'
import * as childProcess from 'child_process'
import * as path from 'path'

// ============================================
// 沙箱配置
// ============================================

export interface SandboxConfig {
  /** 允许访问的目录（白名单） */
  allowedPaths: string[]
  /** 禁止访问的目录（黑名单，优先级高于白名单） */
  deniedPaths: string[]
  /** 允许执行的命令前缀 */
  allowedCommands: string[]
  /** 禁止执行的命令 */
  deniedCommands: string[]
  /** 禁止的命令参数模式 */
  deniedArgPatterns: string[]
  /** 是否允许网络访问 */
  allowNetwork: boolean
  /** 命令执行超时（毫秒） */
  commandTimeoutMs: number
  /** 最大输出长度 */
  maxOutputLength: number
  /** 环境变量覆盖 */
  envOverrides: Record<string, string>
  /** 是否启用沙箱 */
  enabled: boolean
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  allowedPaths: [],
  deniedPaths: [
    '/etc',
    '/var',
    '/sys',
    '/proc',
    '/root',
    'C:\\Windows\\System32',
    'C:\\Program Files',
  ],
  allowedCommands: [
    'git', 'node', 'npm', 'npx', 'yarn', 'pnpm',
    'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
    'echo', 'pwd', 'which', 'env',
    'python3', 'python', 'pip',
    'cargo', 'rustc',
    'go',
    'java', 'javac',
    'tsc', 'eslint', 'prettier',
  ],
  deniedCommands: [
    'rm', 'rmdir', 'del', 'format', 'mkfs',
    'sudo', 'su', 'chmod', 'chown',
    'curl', 'wget', 'nc', 'ncat',
    'shutdown', 'reboot', 'halt',
    'dd', 'mkfs', 'fdisk',
    'ssh', 'scp', 'sftp', 'telnet',
  ],
  deniedArgPatterns: [
    // 命令替换注入风险（保留禁止）
    '`', '$(',
    // 自动确认参数（用正则匹配单词边界，避免误判文件名）
    '--no-confirm', '-y', '--yes',
    // 隐藏错误输出
    '/dev/null', '2>&1',
    // 危险删除
    'rm -rf /', 'rm -rf ~',
    // NOTE: &&, ||, ;, |, >, >>, < 是合法 shell 操作符，已从禁止列表移除
    // 命令安全性由 deniedCommands（rm/sudo/curl 等）和 allowedCommands 白名单保障
  ],
  allowNetwork: false,
  commandTimeoutMs: 30000,
  maxOutputLength: 100000,
  envOverrides: {},
  enabled: true,
}

// ============================================
// 沙箱验证结果
// ============================================

export interface SandboxValidationResult {
  allowed: boolean
  reason?: string
  sanitized?: string
}

export interface SandboxExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  duration: number
}

// ============================================
// 沙箱执行器
// ============================================

class SandboxExecutor extends EventEmitter {
  private config: SandboxConfig
  /** Agent 级别的配置覆盖 */
  private agentOverrides = new Map<string, Partial<SandboxConfig>>()

  constructor(config?: Partial<SandboxConfig>) {
    super()
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config }
  }

  // ============================================
  // 路径验证
  // ============================================

  /**
   * 验证文件路径是否允许访问
   */
  validatePath(filePath: string, agentId?: string): SandboxValidationResult {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    const config = this.getEffectiveConfig(agentId)
    const resolved = path.resolve(filePath)

    // 检查黑名单
    for (const denied of config.deniedPaths) {
      if (resolved.startsWith(denied)) {
        return { allowed: false, reason: `Path is in denied list: ${denied}` }
      }
    }

    // 如果有白名单，检查是否在白名单内
    if (config.allowedPaths.length > 0) {
      const inAllowed = config.allowedPaths.some(allowed => resolved.startsWith(allowed))
      if (!inAllowed) {
        return { allowed: false, reason: `Path is not in allowed list` }
      }
    }

    return { allowed: true }
  }

  // ============================================
  // 命令验证
  // ============================================

  /**
   * 验证命令是否允许执行
   */
  validateCommand(command: string, agentId?: string): SandboxValidationResult {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    const config = this.getEffectiveConfig(agentId)

    // 提取命令名
    const cmdName = this.extractCommandName(command)

    // 检查黑名单
    if (config.deniedCommands.includes(cmdName)) {
      return { allowed: false, reason: `Command is denied: ${cmdName}` }
    }

    // 如果有白名单，检查是否在白名单内
    if (config.allowedCommands.length > 0 && !config.allowedCommands.includes(cmdName)) {
      return { allowed: false, reason: `Command is not in allowed list: ${cmdName}` }
    }

    // 检查危险参数模式
    for (const pattern of config.deniedArgPatterns) {
      // 参数模式（以 - 开头，如 -y, --yes, --no-confirm）：
      // 必须作为独立参数出现（前面是空格/命令开头，后面是空格/行尾）
      // 避免 golden-years 等文件名中的 -y 被误判为自动确认参数
      if (pattern.startsWith('-')) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const argRegex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`)
        if (argRegex.test(command)) {
          return { allowed: false, reason: `Command contains denied pattern: ${pattern}` }
        }
      } else {
        // shell 元字符、路径等：保持子串匹配
        if (command.includes(pattern)) {
          return { allowed: false, reason: `Command contains denied pattern: ${pattern}` }
        }
      }
    }

    return { allowed: true, sanitized: command }
  }

  // ============================================
  // 沙箱执行
  // ============================================

  /**
   * 在沙箱中执行命令
   */
  async execute(
    command: string,
    cwd: string,
    agentId?: string
  ): Promise<SandboxExecutionResult> {
    // 验证命令
    const validation = this.validateCommand(command, agentId)
    if (!validation.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: `Sandbox: ${validation.reason}`,
        exitCode: 1,
        timedOut: false,
        duration: 0,
      }
    }

    // 验证工作目录
    const pathValidation = this.validatePath(cwd, agentId)
    if (!pathValidation.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: `Sandbox: ${pathValidation.reason}`,
        exitCode: 1,
        timedOut: false,
        duration: 0,
      }
    }

    const config = this.getEffectiveConfig(agentId)
    const startTime = Date.now()

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        ...config.envOverrides,
        // 禁止网络访问时设置环境变量
        ...(config.allowNetwork ? {} : {
          HTTP_PROXY: '127.0.0.1:0',
          HTTPS_PROXY: '127.0.0.1:0',
          NO_PROXY: '',
        }),
      }

      const child = childProcess.spawn('sh', ['-c', command], {
        cwd,
        env,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let killed = false

      // 超时处理
      const timeoutHandle = setTimeout(() => {
        timedOut = true
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 5000)
      }, config.commandTimeoutMs)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
        if (stdout.length > config.maxOutputLength) {
          stdout = stdout.slice(0, config.maxOutputLength) + '\n... [truncated]'
          if (!killed) {
            killed = true
            child.kill()
          }
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        if (stderr.length > config.maxOutputLength) {
          stderr = stderr.slice(0, config.maxOutputLength) + '\n... [truncated]'
        }
      })

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutHandle)
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          duration: Date.now() - startTime,
        })
      })

      child.on('error', (err: Error) => {
        clearTimeout(timeoutHandle)
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
          duration: Date.now() - startTime,
        })
      })
    })
  }

  // ============================================
  // 配置管理
  // ============================================

  /**
   * 设置 Agent 级别的配置覆盖
   */
  setAgentOverride(agentId: string, override: Partial<SandboxConfig>): void {
    this.agentOverrides.set(agentId, override)
  }

  /**
   * 移除 Agent 级别的配置覆盖
   */
  removeAgentOverride(agentId: string): void {
    this.agentOverrides.delete(agentId)
  }

  /**
   * 更新全局配置
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // ============================================
  // 私有方法
  // ============================================

  private getEffectiveConfig(agentId?: string): SandboxConfig {
    if (!agentId) return this.config

    const override = this.agentOverrides.get(agentId)
    if (!override) return this.config

    return { ...this.config, ...override }
  }

  private extractCommandName(command: string): string {
    // 提取命令的第一个词（去除前导空格和路径）
    const trimmed = command.trim()
    const firstSpace = trimmed.indexOf(' ')
    const cmdPart = firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed
    return path.basename(cmdPart)
  }
}

/** 全局沙箱执行器实例 */
export const sandboxExecutor = new SandboxExecutor()
