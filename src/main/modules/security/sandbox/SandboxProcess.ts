/**
 * 沙箱子进程公共设施
 *
 * 三个后端（local / docker / e2b 的本地侧）共用同一套「跑一个子进程并收敛结果」的语义，
 * 抽到这里避免三份实现漂移：
 *
 *   1. **进程组回收**：`sh -c "sleep 100"` 只杀 `sh` 不会杀 `sleep`，超时后会留下孤儿进程
 *      占着端口/文件锁。故在 POSIX 下 `detached: true` 建独立进程组，超时时 `kill(-pid)` 整组回收。
 *   2. **超时两段式**：先 `SIGTERM`（给进程收尾机会），宽限期后再 `SIGKILL`（不给逃逸机会）。
 *   3. **输出按字节封顶**：累计到 `maxOutputBytes` 后**停止累积但不禁停进程** ——
 *      内存有界即可；急着 kill 会把 `ls -R` 这类正常的大输出命令误判为失败，
 *      真正的失控输出交给超时兜底。
 *   4. **截断必须标记**：不标记的话模型会以为输出完整，据此做出错误判断。
 *
 * @module security/sandbox/SandboxProcess
 */

import { spawn, type ChildProcess } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

/** SIGTERM → SIGKILL 的宽限期 */
export const KILL_GRACE_MS = 3_000

/** 临时沙箱目录前缀（同时作为「这是沙箱目录」的识别标识） */
export const SANDBOX_TMP_PREFIX = 'aweeclaw-sandbox-'

/**
 * 环境变量白名单。
 *
 * 刻意**不继承** `process.env`：宿主环境里带着用户的 API Key、代理、CI 凭证，
 * 一次性全量透传给 AI 生成的命令等于把整个密钥库暴露给可能被注入的代码。
 *
 * 跨平台项（PATH 等）常驻；POSIX 的家目录相关项只在 `workspace` 模式下保留，
 * `temp` 模式下家目录被指向沙箱自己的临时目录（见 `buildSandboxEnv`）。
 */
const ENV_COMMON = [
  'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'NO_COLOR',
  // Windows 运行任意可执行文件的必需品，缺一个就会「命令找不到」
  'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'WINDIR',
  'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS',
]

const ENV_WORKSPACE_ONLY = ['HOME', 'USER', 'LOGNAME', 'SHELL']

// ============================================
// 子进程执行
// ============================================

export interface ProcessRunOptions {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  maxOutputBytes: number
  /** 附加到子进程的 stdin 内容；不传则 stdin 为 /dev/null（避免命令等待输入挂死） */
  stdin?: string
  /**
   * 超时触发时的额外回调（在 SIGTERM 之前调用）。
   *
   * docker 后端必需：`docker run` 的 CLI 只是客户端，**杀掉 CLI 不会停掉容器**
   * ——容器会继续在后台跑，成为孤儿。所以超时时必须由这里执行 `docker rm -f <name>`
   * 才能真正终止工作负载。
   */
  onTimeout?: () => void
}

export interface ProcessRunOutcome {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  /** 子进程启动失败（如可执行文件不存在）时的错误信息 */
  spawnError: string
  durationMs: number
}

/** 按字节累积、到上限后封顶的收集器 */
class CappedCollector {
  private chunks: Buffer[] = []
  private size = 0
  private limit: number

  truncated = false

  constructor(limit: number) {
    this.limit = limit
  }

  push(chunk: Buffer): void {
    if (this.size >= this.limit) {
      // 已达上限：仅标记，不再累积（内存有界）
      this.truncated = true
      return
    }
    const remaining = this.limit - this.size
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining))
      this.size = this.limit
      this.truncated = true
    } else {
      this.chunks.push(chunk)
      this.size += chunk.length
    }
  }

  /** 转字符串；被截断时追加显式标记 */
  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf-8')
    if (!this.truncated) return text
    return `${text}\n...[truncated: output exceeded ${this.limit} bytes]`
  }
}

/**
 * 终结整个进程组。
 *
 * POSIX 下 `detached: true` 让子进程成为新进程组的组长，`-pid` 即组内全部进程。
 * 组已不存在时 `process.kill` 抛 `ESRCH`，属预期，静默忽略。
 */
export function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (!pid) return

  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // 落到单进程兜底
    }
  }

  try {
    child.kill(signal)
  } catch (err) {
    logger.security.debug('[Sandbox] kill failed (process already gone):', err)
  }
}

/** 执行一个受限子进程并收敛结果 */
export function runProcess(options: ProcessRunOptions): Promise<ProcessRunOutcome> {
  const { file, args, cwd, env, timeoutMs, maxOutputBytes, stdin, onTimeout } = options
  const startTime = Date.now()

  return new Promise<ProcessRunOutcome>((resolve) => {
    const stdoutCollector = new CappedCollector(maxOutputBytes)
    const stderrCollector = new CappedCollector(maxOutputBytes)

    let settled = false
    let timedOut = false
    let spawnError = ''

    // 定时器句柄先声明后赋值：`finish` 会在「spawn 同步抛错」这条路径上被调用，
    // 那时它们还没被赋值，直接 clearTimeout 会踩 TDZ 抛 ReferenceError。
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let killHandle: ReturnType<typeof setTimeout> | null = null

    const clearTimers = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (killHandle) clearTimeout(killHandle)
      timeoutHandle = null
      killHandle = null
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimers()
      resolve({
        stdout: stdoutCollector.toString(),
        stderr: stderrCollector.toString(),
        exitCode,
        timedOut,
        stdoutTruncated: stdoutCollector.truncated,
        stderrTruncated: stderrCollector.truncated,
        spawnError,
        durationMs: Date.now() - startTime,
      })
    }

    let child: ChildProcess
    try {
      child = spawn(file, args, {
        cwd,
        env,
        // stdin 置空：AI 生成的命令里常有 `read` / `python -c "input()"`，
        // 继承父进程 stdin 会让它永远等不到输入、把任务挂死。
        stdio: ['pipe', 'pipe', 'pipe'],
        // POSIX 下建新进程组，便于整组回收；Windows 下 detached 会弹控制台窗口，必须关掉
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      spawnError = err instanceof Error ? err.message : String(err)
      logger.security.warn(`[Sandbox] spawn threw: ${spawnError}`)
      // 同步抛出的场景没有 child，直接以失败收敛
      clearTimers()
      resolve({
        stdout: '',
        stderr: spawnError,
        exitCode: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        spawnError,
        durationMs: Date.now() - startTime,
      })
      return
    }

    if (stdin !== undefined) {
      try {
        child.stdin?.write(stdin)
      } catch (err) {
        logger.security.debug('[Sandbox] stdin write failed:', err)
      }
    }
    // 写完立刻关闭，让 `cat` 这类命令正常结束而不是永久等待
    try {
      child.stdin?.end()
    } catch {
      /* 已关闭 */
    }

    timeoutHandle = setTimeout(() => {
      timedOut = true
      // 先做后端专有的清理（如 `docker rm -f`），再杀 CLI 进程本身
      try {
        onTimeout?.()
      } catch (err) {
        logger.security.warn('[Sandbox] onTimeout hook failed:', err)
      }
      killProcessGroup(child, 'SIGTERM')
      killHandle = setTimeout(() => {
        killProcessGroup(child, 'SIGKILL')
      }, KILL_GRACE_MS)
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => stdoutCollector.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrCollector.push(chunk))

    child.on('error', (err: Error) => {
      spawnError = err.message
      finish(null)
    })

    child.on('close', (code: number | null) => {
      finish(code)
    })
  })
}

// ============================================
// Shell 与命令封装
// ============================================

/**
 * 选择承载命令的 shell。
 *
 * AI 传入的是一条 **shell 命令行**（含 `&&`、管道、重定向），必须由 shell 解释，
 * 无法拆成 argv 数组执行 —— 这是唯一能保持语义等价的方案。
 *
 * 安全性由两点保证：
 *   1. 整条命令作为**单个 argv 元素**传入（`['-c', command]`），不做任何字符串拼接，
 *      因此不存在「用户输入拼进命令串」这一经典注入面；
 *   2. 执行发生在沙箱内部（受限 cwd / env，或容器 / 云沙箱）。
 */
export function buildShellInvocation(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  // -c 而非 -lc：登录 shell 会去读 ~/.profile / ~/.zshrc，把用户自定义别名与
  // 代理环境变量重新灌回来，等于绕过我们的 env 白名单。
  return { file: '/bin/sh', args: ['-c', command] }
}

/**
 * 构造受限环境变量。
 *
 * @param mode `workspace` 保留家目录相关变量；`temp` 把 HOME 指向沙箱目录，
 *             避免命令把缓存/配置写进用户真实家目录
 */
export function buildSandboxEnv(
  mode: 'workspace' | 'temp',
  sandboxDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  const whitelist = mode === 'workspace' ? [...ENV_COMMON, ...ENV_WORKSPACE_ONLY] : ENV_COMMON

  for (const key of whitelist) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) env[key] = value
  }

  // 兜底 PATH：极端情况下宿主未设置 PATH 时，至少让常见工具链可解析
  if (!env.PATH) {
    env.PATH = process.platform === 'win32'
      ? 'C:\\Windows\\System32;C:\\Windows'
      : '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  }

  if (mode === 'temp') {
    env.HOME = sandboxDir
    if (process.platform === 'win32') {
      env.USERPROFILE = sandboxDir
    }
    env.TMPDIR = sandboxDir
    env.TMP = sandboxDir
    env.TEMP = sandboxDir
  }

  // 去掉 ANSI 颜色：转义序列会污染模型上下文，且对模型理解输出毫无增益
  env.NO_COLOR = '1'
  // 标记位：命令（或用户脚本）可据此判断自己跑在沙箱里
  env.AWEE_SANDBOX = '1'
  env.AWEE_SANDBOX_DIR = sandboxDir

  return { ...env, ...extra }
}

// ============================================
// 临时目录
// ============================================

/** 新建一个沙箱临时目录 */
export function createSandboxTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_TMP_PREFIX))
  return dir
}

/**
 * 删除沙箱临时目录。
 *
 * 只删自己建的目录（用前缀二次确认），避免调用方传错路径把用户目录删掉。
 * docker 后端以 root 身份写入的文件可能删不掉（EACCES），此时降级为 warn：
 * 残留一个临时目录比抛异常中断整个命令链路要好。
 */
export function removeSandboxTempDir(dir: string): void {
  if (!dir) return
  const base = path.basename(dir)
  if (!base.startsWith(SANDBOX_TMP_PREFIX)) {
    logger.security.warn('[Sandbox] refuse to remove non-sandbox dir:', dir)
    return
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  } catch (err) {
    logger.security.warn('[Sandbox] remove temp dir failed:', dir, err)
  }
}

// ============================================
// 输出组装
// ============================================

/** 单流输出上限提示（拼进 notes） */
export function describeTruncation(
  stdoutTruncated: boolean,
  stderrTruncated: boolean,
  maxOutputBytes: number,
): string[] {
  const notes: string[] = []
  if (stdoutTruncated) notes.push(`stdout 超过 ${maxOutputBytes} 字节，已截断（后续内容未捕获）`)
  if (stderrTruncated) notes.push(`stderr 超过 ${maxOutputBytes} 字节，已截断（后续内容未捕获）`)
  return notes
}
