/**
 * Python Sidecar 客户端（本地语音公共基础设施）
 *
 * 职责：
 * 1. 脚本路径解析：兼容「打包后（extraResources）」与「开发环境（源码目录）」两种形态
 * 2. 进程启动握手：等待脚本输出 `{"type":"ready"}`，而不是固定 sleep 一秒
 * 3. JSON-Lines 协议：请求携带 requestId，响应按 requestId 精确分发
 * 4. 失败可诊断：进程退出 / 超时都会带上退出码与 stderr 尾部，避免只报「启动超时」
 *
 * 为什么需要这一层：
 * 早期 ASR / TTS 引擎各自复制了一份 spawn 逻辑，用固定的
 * `setTimeout(1000)` 判断「进程是否启动成功」，并用
 * `path.join(__dirname, '..', '..', ...)` 猜脚本路径。
 * 结果是：脚本路径永远不存在 → python3 立即以退出码 2 结束 →
 * 1 秒后统一报「Python 进程启动超时」，把真正的失败原因（文件不存在）吞掉了。
 *
 * @module local-voice/pythonSidecar
 */

import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { resolveRuntimePythonPath } from '../python-runtime/resolvePythonPath'

/** sidecar 脚本所在的目录名（相对 local-voice 模块目录） */
const PY_DIR_NAME = 'py'

/** 默认启动握手超时（毫秒） */
const DEFAULT_START_TIMEOUT_MS = 20_000

/** 保留的 stderr 尾部长度（用于错误提示） */
const STDERR_TAIL_LIMIT = 4_000

/** 安全读取 Electron 应用根目录（非 Electron 上下文下返回 null） */
function safeAppPath(): string | null {
  try {
    return app.getAppPath()
  } catch {
    return null
  }
}

/**
 * 解析 Python sidecar 脚本的绝对路径
 *
 * 候选顺序：
 * 1. `<resources>/py/<file>`      —— 打包后由 extraResources 输出
 * 2. `<appPath>/src/main/modules/local-voice/py/<file>` —— 开发 / 测试环境
 * 3. `<appPath>/dist/main/modules/local-voice/py/<file>` —— 若脚本被复制进产物目录
 * 4. `<__dirname>/py/<file>`      —— 脚本与引擎同目录部署
 * 5. 从 __dirname 回溯到仓库根的源码目录 —— 兼容 ts 直跑 / 非常规 outDir
 */
export function resolveSidecarScript(fileName: string): string {
  const candidates: string[] = []
  const sourceRelative = path.join('src', 'main', 'modules', 'local-voice', PY_DIR_NAME, fileName)

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, PY_DIR_NAME, fileName))
  }

  const appPath = safeAppPath()
  if (appPath) {
    candidates.push(path.join(appPath, sourceRelative))
    candidates.push(path.join(appPath, 'dist', 'main', 'modules', 'local-voice', PY_DIR_NAME, fileName))
  }

  candidates.push(path.join(__dirname, PY_DIR_NAME, fileName))
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', sourceRelative))
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', '..', sourceRelative))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    `未找到 Python 运行脚本 ${fileName}，已尝试路径：\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  )
}

/** 命令响应（Python 侧输出的单条 JSON 消息） */
export interface SidecarMessage {
  type: string
  requestId?: string
  message?: string
  [key: string]: unknown
}

/** 待响应请求 */
interface PendingRequest {
  resolve: (message: SidecarMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface PythonSidecarOptions {
  /** py 目录下的脚本文件名，如 `sherpa_asr.py` */
  scriptFile: string
  /** 日志前缀，如 `SherpaAsr` */
  label: string
  /** 启动握手超时（毫秒），默认 20s */
  startTimeoutMs?: number
}

/**
 * Python sidecar 进程客户端
 *
 * 生命周期：`start()` → 多次 `request()` → `dispose()`。
 * `start()` 幂等，可并发调用。
 */
export class PythonSidecar {
  private readonly options: PythonSidecarOptions

  private child: ChildProcess | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private pending = new Map<string, PendingRequest>()
  private onReady: (() => void) | null = null
  private lastExitDetail: string | null = null

  constructor(options: PythonSidecarOptions) {
    this.options = options
  }

  /** 进程是否已就绪（可直接收发命令） */
  isReady(): boolean {
    return this.ready && this.child !== null
  }

  /** 启动进程并等待就绪握手（幂等） */
  async start(): Promise<void> {
    if (this.isReady()) return
    if (this.starting) return this.starting

    this.starting = this.doStart().finally(() => {
      this.starting = null
    })

    return this.starting
  }

  /**
   * 发送命令并等待同 requestId 的响应
   *
   * @param command Python 侧命令名（initialize / recognize / synthesize / dispose ...）
   * @param params 命令参数
   * @param timeoutMs 超时时间；模型加载类命令需要给足（默认 30s）
   */
  async request<T extends SidecarMessage = SidecarMessage>(
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    if (!this.child || !this.child.stdin) {
      throw new Error(this.lastExitDetail ?? 'Python 进程未启动')
    }
    if (!this.ready) {
      throw new Error('Python 进程尚未就绪')
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Python 命令超时（${command}，${Math.round(timeoutMs / 1000)}s）`))
      }, timeoutMs)

      this.pending.set(requestId, {
        resolve: resolve as (message: SidecarMessage) => void,
        reject,
        timer,
      })

      const payload = JSON.stringify({ command, requestId, params }) + '\n'
      this.child!.stdin!.write(payload, (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(requestId)
          reject(new Error(`发送命令失败: ${error.message}`))
        }
      })
    })
  }

  /** 停止进程（不再接受新命令） */
  dispose(): void {
    this.failPending(new Error('Python 进程已停止'))
    this.killChild()
    logger.system.info(`[${this.options.label}] Python sidecar 已停止`)
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  private async doStart(): Promise<void> {
    const label = this.options.label
    const startTimeoutMs = this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS

    const scriptPath = resolveSidecarScript(this.options.scriptFile)
    // 解释器必须与「依赖安装所用的解释器」一致：
    // 统一走 resolveRuntimePythonPath，它会 await ensureReady() 并校验路径，
    // 失败时直接抛错——绝不静默回退系统 python（否则会出现「依赖装在 venv、
    // 脚本却用系统 python3 跑」的错配，报出 "No module named 'xxx'"）
    const { pythonPath, source } = await resolveRuntimePythonPath(label)
    // cwd 选在 py 的父目录，保证脚本内 `from py.xxx import ...` 可解析
    const cwd = path.dirname(path.dirname(scriptPath))

    logger.system.info(
      `[${label}] 启动 Python sidecar (${source}): ${pythonPath} "${scriptPath}"`,
    )

    const child = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })

    this.child = child
    this.ready = false
    this.stderrTail = ''
    this.stdoutBuffer = ''
    this.lastExitDetail = null

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.onReady = null
        if (error) {
          this.killChild()
          reject(error)
        } else {
          resolve()
        }
      }

      const timer = setTimeout(() => {
        settle(
          new Error(
            `Python 进程启动超时（${Math.round(startTimeoutMs / 1000)}s 内未收到就绪信号）${this.stderrSuffix()}`,
          ),
        )
      }, startTimeoutMs)

      // 就绪信号由 stdout 的 {"type":"ready"} 触发
      this.onReady = () => settle()

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk))

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT)
        const text = String(chunk).trim()
        if (text) logger.system.debug(`[${label}] stderr: ${text}`)
      })

      child.once('error', (error) => {
        const detail = `Python 进程启动失败: ${error.message}`
        this.lastExitDetail = detail
        settle(new Error(detail))
      })

      child.once('exit', (code, signal) => {
        const detail = this.describeExit(code, signal)
        this.lastExitDetail = detail
        this.child = null
        this.ready = false

        // 待响应请求全部失败，避免调用方永久挂起
        this.failPending(new Error(detail))

        if (!settled) {
          settle(new Error(detail))
        } else {
          logger.system.warn(`[${label}] ${detail}`)
        }
      })
    })
  }

  /** 解析 stdout 中的 JSON-Lines 协议消息 */
  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk

    const lines = this.stdoutBuffer.split('\n')
    // 最后一段可能是不完整行，留到下次拼接
    this.stdoutBuffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // 协议约定：响应以 "JSON:" 前缀输出；同时兼容无前缀的纯 JSON 行
      const payload = line.startsWith('JSON:') ? line.slice(5).trim() : line
      if (!payload.startsWith('{')) {
        logger.system.debug(`[${this.options.label}] stdout: ${line}`)
        continue
      }

      let message: SidecarMessage
      try {
        message = JSON.parse(payload) as SidecarMessage
      } catch {
        logger.system.debug(`[${this.options.label}] stdout（非 JSON）: ${line}`)
        continue
      }

      this.handleMessage(message)
    }
  }

  /** 分发单条协议消息 */
  private handleMessage(message: SidecarMessage): void {
    const label = this.options.label

    if (message.type === 'ready') {
      this.ready = true
      logger.system.info(`[${label}] Python 进程就绪`)
      this.onReady?.()
      return
    }

    const requestId = typeof message.requestId === 'string' ? message.requestId : ''
    const pending = requestId ? this.pending.get(requestId) : undefined

    if (!pending) {
      // 无 requestId 主动上报的错误（如脚本内部异常）只记日志
      if (message.type === 'error') {
        logger.system.error(`[${label}] Python 上报错误: ${message.message ?? '未知错误'}`)
      } else {
        logger.system.debug(`[${label}] 未匹配的响应: ${JSON.stringify(message).slice(0, 200)}`)
      }
      return
    }

    clearTimeout(pending.timer)
    this.pending.delete(requestId)

    if (message.type === 'error') {
      pending.reject(new Error(String(message.message || 'Python 侧执行失败')))
    } else {
      pending.resolve(message)
    }
  }

  /** 终止子进程（先 SIGTERM，3s 后兜底 SIGKILL） */
  private killChild(): void {
    const child = this.child
    this.child = null
    this.ready = false
    this.onReady = null
    if (!child) return

    try {
      child.kill('SIGTERM')
    } catch {
      // 进程可能已退出，忽略
    }

    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 忽略
      }
    }, 3_000)
    killer.unref?.()
  }

  /** 让所有待响应请求失败 */
  private failPending(error: Error): void {
    for (const [, request] of this.pending) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  /** 生成退出原因描述 */
  private describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    const reason = signal ? `信号 ${signal}` : `退出码 ${code}`
    return `Python 进程已退出（${reason}）${this.stderrSuffix()}`
  }

  /** stderr 尾部摘要（单行，便于在 toast 中展示） */
  private stderrSuffix(): string {
    const tail = this.stderrTail.trim()
    if (!tail) return ''
    const compact = tail.replace(/\s+/g, ' ').slice(-600)
    return `\nPython 输出: ${compact}`
  }
}
