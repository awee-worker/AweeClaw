/**
 * Python 运行时桥接层
 *
 * 让插件复用客户端内置的 Python 运行时（PythonRuntimeManager 管理的
 * 受管解释器 / venv），而不是各自去探测系统 python3。
 *
 * 为什么需要这一层：
 * 插件自己 `spawn('python3', ...)` 会遇到三个坑——
 * 1. 系统 Python 版本不确定（很多脚本要求 >= 3.10，而 macOS 自带 3.9）；
 * 2. 「装依赖的解释器」与「跑脚本的解释器」不是同一个，报错极具误导性
 *    （No module named 'xxx'）；
 * 3. 每个插件重复实现超时 / 输出截断 / 环境变量注入，质量参差。
 *
 * 因此统一收敛到这里，插件通过 `globalThis.__AWEECLAW_HOST__.pythonRuntime`
 * 或 `ctx.host.pythonRuntime` 调用（后者按 manifest.permissions 校验，
 * 需声明 `python.runtime` 权限）。
 *
 * 暴露能力：
 * - getStatus()  只读快照，不触发安装/下载
 * - resolve()    解析解释器绝对路径（会 await ensureReady）
 * - run()        受控执行 .py 脚本（超时 / 输出上限 / 并发上限 / 环境变量固定）
 *
 * @module plugin-sdk/PythonRuntimeBridge
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '@shared/toolkit/LogEngine'
import { pythonManager, type PythonStatus, type VersionTuple } from '../python-runtime/PythonRuntimeManager'
import {
  resolveRuntimePythonPath,
  PythonRuntimeUnavailableError,
  type ResolvedPythonPath,
  type ResolvePythonOptions,
} from '../python-runtime/resolvePythonPath'

export { PythonRuntimeUnavailableError }
export type { PythonStatus, ResolvedPythonPath, ResolvePythonOptions }

/** 默认执行超时：5 分钟 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
/** 超时上限：30 分钟（长任务由调用方显式提高） */
const MAX_TIMEOUT_MS = 30 * 60 * 1000
/** 默认单路输出上限：4 MB */
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
/** 并发执行上限：避免插件批量跑脚本打满 CPU */
const MAX_CONCURRENCY = 4
/** 强杀前的优雅退出等待 */
const SIGKILL_GRACE_MS = 3000

/** 脚本执行选项 */
export interface PythonRunOptions {
  /** 传给脚本的参数列表（不做 shell 解析，原样透传，避免注入） */
  args?: string[]
  /** 工作目录，默认为脚本所在目录 */
  cwd?: string
  /** 超时毫秒数，默认 5 分钟，上限 30 分钟 */
  timeoutMs?: number
  /** 单路 stdout/stderr 上限（字节），默认 4 MB */
  maxOutputBytes?: number
  /** 追加/覆盖的环境变量（会与安全默认值合并） */
  env?: Record<string, string>
  /** 日志标识，用于定位是哪个插件/功能在跑脚本 */
  label?: string
  /**
   * 脚本要求的最低 Python 版本，如 `[3, 10]`。
   *
   * 声明它比在脚本里等 SyntaxError 更好：解析层会直接跳过不满足的解释器，
   * 并在无候选可用时给出「需要 3.10+」这类可操作的理由。
   */
  minVersion?: VersionTuple
}

/** 脚本执行结果 */
export interface PythonRunResult {
  /** 退出码；被信号杀死时为 -1 */
  code: number
  /** 标准输出（超限时已截断） */
  stdout: string
  /** 标准错误（超限时已截断；超时被杀会追加说明） */
  stderr: string
  /** 耗时毫秒 */
  durationMs: number
  /** 输出是否因超过上限被截断 */
  truncated: boolean
  /** 是否因超时被强制终止 */
  timedOut: boolean
  /** 本次使用的解释器绝对路径 */
  pythonPath: string
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Python 运行时桥接服务
 *
 * 单例，无状态缓存（解释器路径由 PythonRuntimeManager 统一缓存）。
 */
class PythonRuntimeBridgeService {
  /** 当前执行中的脚本数 */
  private active = 0
  /** 并发已满时的排队等待者 */
  private waiters: Array<() => void> = []

  /**
   * 只读快照：返回当前 Python 环境状态，**不触发**任何安装或下载。
   *
   * 适合插件的 status / 自检工具使用。
   */
  getStatus(): PythonStatus {
    return pythonManager.status
  }

  /**
   * 解析可用解释器的绝对路径（按需触发环境初始化）。
   *
   * @throws PythonRuntimeUnavailableError 环境不可用或解释器不存在
   */
  async resolve(
    label = 'plugin',
    options: ResolvePythonOptions = {},
  ): Promise<ResolvedPythonPath> {
    return resolveRuntimePythonPath(label, options)
  }

  /**
   * 执行一个 .py 脚本并收集输出。
   *
   * 安全约束（对插件是硬性的）：
   * - scriptPath 必须是**绝对路径**且指向已存在的 `.py` 文件
   * - 不经过 shell（参数原样透传），避免命令注入
   * - 输出上限 + 超时强杀 + 并发闸门
   * - 强制 PYTHONUNBUFFERED / PYTHONIOENCODING / PYTHONDONTWRITEBYTECODE
   */
  async run(scriptPath: string, options: PythonRunOptions = {}): Promise<PythonRunResult> {
    const absPath = this.assertScriptPath(scriptPath)
    const label = options.label ?? 'plugin'
    const { pythonPath } = await this.resolve(label, { minVersion: options.minVersion })

    const timeoutMs = clamp(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS)
    const maxOutputBytes = clamp(
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      64 * 1024,
      32 * 1024 * 1024,
    )

    await this.acquire()
    const startedAt = Date.now()

    try {
      return await new Promise<PythonRunResult>((resolve, reject) => {
        const child = spawn(pythonPath, [absPath, ...(options.args ?? [])], {
          cwd: options.cwd ?? path.dirname(absPath),
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONDONTWRITEBYTECODE: '1',
            ...options.env,
          },
          windowsHide: true,
        })

        let stdout = ''
        let stderr = ''
        let truncated = false
        let timedOut = false
        let settled = false
        let killTimer: NodeJS.Timeout | null = null

        const append = (prev: string, chunk: Buffer): string => {
          if (Buffer.byteLength(prev, 'utf8') >= maxOutputBytes) {
            truncated = true
            return prev
          }
          const next = prev + chunk.toString('utf8')
          if (Buffer.byteLength(next, 'utf8') > maxOutputBytes) {
            truncated = true
            // 粗截断：可能切到多字节字符尾部，仅影响日志可读性，不影响退出码判定
            return next.slice(0, maxOutputBytes)
          }
          return next
        }

        const timeoutTimer = setTimeout(() => {
          timedOut = true
          logger.system.warn(
            `[PythonRuntimeBridge] ${label} 脚本执行超时（${timeoutMs}ms），终止进程: ${absPath}`,
          )
          child.kill('SIGTERM')
          killTimer = setTimeout(() => {
            child.kill('SIGKILL')
          }, SIGKILL_GRACE_MS)
        }, timeoutMs)

        const cleanup = (): void => {
          clearTimeout(timeoutTimer)
          if (killTimer) clearTimeout(killTimer)
        }

        child.stdout?.on('data', (chunk: Buffer) => {
          stdout = append(stdout, chunk)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = append(stderr, chunk)
        })

        child.on('error', (err) => {
          if (settled) return
          settled = true
          cleanup()
          reject(err)
        })

        child.on('close', (code) => {
          if (settled) return
          settled = true
          cleanup()

          const durationMs = Date.now() - startedAt
          const finalStderr = timedOut
            ? `${stderr}\n[PythonRuntimeBridge] 进程因超时（${timeoutMs}ms）被终止`
            : stderr

          logger.system.debug(
            `[PythonRuntimeBridge] ${label} 脚本结束 code=${code} duration=${durationMs}ms` +
              `${truncated ? ' (输出已截断)' : ''}`,
          )

          resolve({
            code: code ?? -1,
            stdout,
            stderr: finalStderr,
            durationMs,
            truncated,
            timedOut,
            pythonPath,
          })
        })
      })
    } finally {
      this.release()
    }
  }

  /** 校验脚本路径：解析为绝对路径 + .py 扩展名 + 已存在的文件 */
  private assertScriptPath(scriptPath: string): string {
    if (typeof scriptPath !== 'string' || scriptPath.trim() === '') {
      throw new Error('[PythonRuntimeBridge] scriptPath 不能为空')
    }
    const absPath = path.resolve(scriptPath)
    if (path.extname(absPath).toLowerCase() !== '.py') {
      throw new Error(`[PythonRuntimeBridge] 仅允许执行 .py 脚本，收到: ${absPath}`)
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(absPath)
    } catch {
      throw new Error(`[PythonRuntimeBridge] 脚本不存在: ${absPath}`)
    }
    if (!stat.isFile()) {
      throw new Error(`[PythonRuntimeBridge] 脚本路径不是文件: ${absPath}`)
    }
    return absPath
  }

  /** 获取并发槽位 */
  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENCY) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active++
  }

  /** 释放并发槽位并唤醒下一个等待者 */
  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}

/** Python 运行时桥接单例 */
export const pythonRuntimeBridge = new PythonRuntimeBridgeService()

/** 桥接服务类型（供 HostServices 接口声明使用） */
export type PythonRuntimeBridge = typeof pythonRuntimeBridge
