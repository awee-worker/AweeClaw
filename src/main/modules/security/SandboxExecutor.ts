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
import { isDangerousCommand, matchDangerousCommand } from '@shared/configuration/dangerousCommands'
import { collectCommandNames, extractSubstitutions } from '@shared/configuration/shellCommand'

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
    // curl/wget 不在黑名单：普通网络请求是常用开发操作（如 curl API 测试）。
    // 危险用法（curl|sh、curl -o 下载可执行文件）由 isDangerousCommand() 精确拦截，
    // 与 terminalSandbox.ts 共用 @shared/configuration/dangerousCommands 的模式定义。
    'nc', 'ncat',
    'shutdown', 'reboot', 'halt',
    'dd', 'mkfs', 'fdisk',
    'ssh', 'scp', 'sftp', 'telnet',
  ],
  deniedArgPatterns: [
    // NOTE: 命令替换（$(...) / 反引号）已从子串黑名单移除。
    // 子串匹配会把 `r=$(lsof -iTCP:8080)`、`echo "$(date)"` 这类日常写法整条拒掉，
    // 而 deny 的理由只有一句 "contains denied pattern: $("，模型会误判成权限问题。
    // 真正的风险从来不是替换语法本身，而是替换体内部执行了被禁止的命令
    // （例如 `$(rm -rf ~)`：命令名检查只取首个词，黑名单抓不到替换体里的 rm）。
    // 现由 validateCommandSegments() 解析替换体并逐个校验内部命令名与危险模式。
    // 跳过确认的参数（可能让 AI 未经用户审批执行破坏性操作）
    // 使用正则匹配独立参数，避免误判文件名（如 --yes-please 不会被匹配）
    '--no-confirm', '--yes',
    // NOTE: 以下模式已从禁止列表移除（经测试验证存在误拦截或冗余）：
    //   - '-y'：ls -y 等命令被误拦截；apt/yum 本身已不在 allowedCommands
    //   - 'rm -rf /' / 'rm -rf ~'：rm 已在 deniedCommands 中，子串匹配反而误拦
    //     合法的 rm -rf /tmp/test、rm -rf ~/Downloads
    //   - '/dev/null' / '2>&1'：合法 shell 重定向操作符，非安全风险
    //   - &&, ||, ;, |, >, >>, <：合法 shell 操作符
    // 命令安全性由 deniedCommands（rm/sudo/curl/dd/mkfs 等）保障
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
   *
   * 策略（四层校验，与 terminalSandbox.ts 保持一致）：
   * 1. 首命令黑名单（deniedCommands）：命中即拒绝 — rm/sudo/dd 等破坏性/提权命令
   * 2. 危险命令模式（isDangerousCommand）：命中即拒绝 — curl|sh、rm -rf / 等
   *    复用 @shared/configuration/dangerousCommands 的模式定义，确保两层共用同一份规则
   * 3. 分段校验（validateCommandSegments）：按 `;` `&&` `||` `|` 拆段、并递归进入
   *    `$(...)` / 反引号替换体，逐个校验内部命令名与内部危险模式。
   *    只查首个词会漏掉 `echo ok; rm -rf x` 与 `r=$(rm -rf ~)`，这一步把口子堵上。
   * 4. 危险参数模式（deniedArgPatterns）：跳过确认参数等
   *
   * 白名单（allowedCommands）字段保留用于配置兼容性，但不参与实际校验。
   */
  validateCommand(command: string, agentId?: string): SandboxValidationResult {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    const config = this.getEffectiveConfig(agentId)

    // 提取命令名
    const cmdName = this.extractCommandName(command)

    // 1. 检查黑名单：命中即拒绝
    if (config.deniedCommands.includes(cmdName)) {
      return { allowed: false, reason: `命令「${cmdName}」在禁止列表中，禁止执行。` }
    }

    // 2. 检查危险命令模式（curl|sh、rm -rf /、wget -O 等）
    //    与 terminalSandbox.ts 的 detectDangerousPatterns 共用同一份模式定义
    if (isDangerousCommand(command)) {
      const matchedPattern = matchDangerousCommand(command)
      return { allowed: false, reason: `检测到危险命令模式: ${matchedPattern}` }
    }

    // 3. 分段校验：复合命令的每一段、以及命令替换内部出现的命令
    const segmentCheck = this.validateCommandSegments(command, config)
    if (!segmentCheck.allowed) {
      return segmentCheck
    }

    // 4. 检查危险参数模式
    for (const pattern of config.deniedArgPatterns) {
      // 参数模式（以 - 开头，如 -y, --yes, --no-confirm）：
      // 必须作为独立参数出现（前面是空格/命令开头，后面是空格/行尾）
      // 避免 golden-years 等文件名中的 -y 被误判为自动确认参数
      if (pattern.startsWith('-')) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const argRegex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`)
        if (argRegex.test(command)) {
          return {
            allowed: false,
            reason: `命令包含被禁止的参数「${pattern}」（跳过确认类参数）。请去掉该参数后重试。`,
          }
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
        windowsHide: true,
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

  /**
   * 分段校验复合命令与命令替换
   *
   * 黑名单只查「首个词」，以下两种写法会绕过去：
   *   - `echo ok; rm -rf ~/data`      —— 第二段才是危险命令
   *   - `r=$(rm -rf ~)`               —— 危险命令藏在替换体里
   * 因此这里把命令拆成可执行段（`;` `&&` `||` `|` 换行）并进入替换体，
   * 逐个命令名过黑名单，替换体整体再跑一次危险模式检测。
   *
   * 拆段与替换体提取由 @shared/configuration/shellCommand 提供，
   * 与 terminalSandbox 执行前校验共用同一份解析，避免两处规则分裂。
   */
  private validateCommandSegments(
    command: string,
    config: SandboxConfig,
  ): SandboxValidationResult {
    // 1. 各执行段与替换体内的命令名过黑名单
    for (const name of collectCommandNames(command)) {
      if (config.deniedCommands.includes(name)) {
        return {
          allowed: false,
          reason:
            `命令中包含被禁止的命令「${name}」。这不是权限问题，也不是路径问题：` +
            `该命令在安全策略中被禁用，请改写命令（去掉该调用或换用受支持的命令）后重试。`,
        }
      }
    }

    // 2. 替换体内部同样要过危险模式（curl|sh、rm -rf / 等）
    for (const inner of extractSubstitutions(command)) {
      if (isDangerousCommand(inner)) {
        return {
          allowed: false,
          reason:
            `命令替换 $(...) 内检测到危险命令模式: ${matchDangerousCommand(inner)}。` +
            `请改写命令，避免在替换体里执行该操作。`,
        }
      }
    }

    return { allowed: true }
  }


}

/** 全局沙箱执行器实例 */
export const sandboxExecutor = new SandboxExecutor()
