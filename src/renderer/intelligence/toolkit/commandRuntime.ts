/**
 * 命令运行时工具集
 *
 * 提供命令执行、交互式终端后端选择、长进程检测等能力。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

/** 命令执行上下文 */
export interface CommandContext {
  /** 工作目录 */
  workingDirectory: string
  /** 环境变量 */
  environment?: Record<string, string>
  /** 超时时间（毫秒） */
  timeout?: number
}

/** 命令执行结果 */
export interface CommandResult {
  /** 退出码 */
  exitCode: number
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 执行时长（毫秒） */
  duration: number
}

/** 终端后端类型 */
export type TerminalBackend = 'pty' | 'pipe'

/* ------------------------------------------------------------------ */
/* 交互式终端后端选择                                                  */
/* ------------------------------------------------------------------ */

/** 需要使用 pipe 后端的平台 */
const PIPE_BACKEND_PLATFORMS = new Set(['darwin'])

/**
 * 获取交互式终端后端类型
 *
 * macOS 上交互式 Agent 会话使用 pipe 后端，避免 PTY 兼容性问题。
 * 其他平台使用 PTY 后端以获得更好的交互体验。
 *
 * @param platform 平台标识（darwin/linux/win32）
 * @returns 终端后端类型
 */
export function getInteractiveTerminalBackend(platform: string): TerminalBackend {
  return PIPE_BACKEND_PLATFORMS.has(platform) ? 'pipe' : 'pty'
}

/* ------------------------------------------------------------------ */
/* 长进程检测                                                          */
/* ------------------------------------------------------------------ */

/** 长运行命令关键词 */
const LONG_RUNNING_KEYWORDS = [
  'npm run dev',
  'npm start',
  'vite',
  'webpack serve',
  'webpack-dev-server',
  'tsc --watch',
  'nodemon',
  'pm2',
  'forever',
  'tail -f',
  'less ',
  'man ',
  'top',
  'htop',
  'vim ',
  'nano ',
  'emacs ',
  'ssh ',
  'telnet ',
  'mysql ',
  'psql ',
  'redis-cli ',
  'mongosh ',
  'docker compose up',
  'docker-compose up',
  'kubectl port-forward',
  'ng serve',
  'jest --watch',
  'vitest --watch',
  'pytest --watch',
]

/**
 * 检测命令是否为长运行命令
 *
 * @param command 命令字符串
 * @param explicitBackground 是否显式请求后台运行
 * @returns 是否为长运行命令
 */
export function isLongRunningCommand(command: string, explicitBackground: boolean): boolean {
  if (explicitBackground) return true

  const trimmed = command.trim().toLowerCase()
  return LONG_RUNNING_KEYWORDS.some(keyword => trimmed.includes(keyword))
}

/* ------------------------------------------------------------------ */
/* 命令运行时                                                          */
/* ------------------------------------------------------------------ */

/**
 * 命令运行时
 *
 * 负责执行命令并返回结果。在渲染进程中为占位实现。
 */
export class CommandRuntime {
  /**
   * 执行命令
   *
   * @param _command 命令
   * @param _args 参数
   * @param _context 执行上下文
   * @returns 执行结果
   */
  async execute(_command: string, _args: string[], _context: CommandContext): Promise<CommandResult> {
    return {
      exitCode: -1,
      stdout: '',
      stderr: 'CommandRuntime: not available in renderer process',
      duration: 0,
    }
  }
}
