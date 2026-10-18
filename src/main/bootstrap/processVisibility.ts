/**
 * 子进程控制台窗口治理（主进程专用）
 *
 * Windows 上通过 child_process 启动控制台程序时，系统会额外分配一个控制台窗口。
 * 调用点没有显式关闭它，用户看到的就是「弹出一个黑框又瞬间消失」；同时主进程要等
 * 窗口创建与销毁，界面跟着卡一下。
 *
 * 逐个调用点补 windowsHide 容易被漏掉：新增代码、第三方库（npx / git / 语言服务器）、
 * promisify 包装都可能绕开既有约定。所以在这里统一兜底——包一层 child_process 的
 * 启动函数，Windows 下默认把 windowsHide 打开；调用方显式传值（包括 false）时原样保留。
 *
 * 必须在任何业务模块之前加载（见 appBootstrap.ts 的导入位置），否则模块内的
 * `import { spawn } from 'node:child_process'` 已经取到原始函数引用，包装不再生效。
 *
 * 另外顺带记录每次子进程启动的来源：黑框闪现有平台偶然性，靠日志能直接看出那一刻
 * 是谁拉起了控制台程序，比逐处猜测调用链更省事。
 */

import childProcess from 'node:child_process'
import { logger } from '@shared/toolkit/LogEngine'

/** 补丁标记：模块被重复加载时不重复包装，避免层层嵌套 */
const PATCH_FLAG = '__aweeclawConsoleHiddenPatch'

/** 启动审计的记录上限：只记前若干条，长会话不至于把日志写满 */
const AUDIT_BUDGET = 200

let auditRemaining = AUDIT_BUDGET

/** 记录一次子进程启动及其调用来源 */
function audit(kind: string, target: string): void {
  if (auditRemaining <= 0) return
  auditRemaining -= 1

  // 从栈里取调用方：跳过本函数与包装函数，后面几帧就是真正的发起位置
  const frames = (new Error().stack || '')
    .split('\n')
    .slice(2, 5)
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .join(' <- ')

  logger.system.debug(`[Spawn] ${kind} ${target}${frames ? ` | ${frames}` : ''}`)
}

/**
 * 给 options 补上 windowsHide
 *
 * 已经是对象时只补缺省值，调用方显式写的值优先；不是对象（省略参数、传了字符串等）
 * 时直接给一份最小 options。
 */
function withHidden(options: unknown): Record<string, unknown> {
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const opt = options as { windowsHide?: boolean }
    return opt.windowsHide === undefined ? { ...opt, windowsHide: true } : (opt as Record<string, unknown>)
  }
  return { windowsHide: true }
}

/** 是否已完成包装 */
function isPatched(cp: Record<string, unknown>): boolean {
  return cp[PATCH_FLAG] === true
}

/* eslint-disable @typescript-eslint/no-explicit-any -- 包装 Node 内置模块的重载签名需要放宽参数类型 */

function patchAsyncApis(cp: any): void {
  const spawnOriginal = cp.spawn
  cp.spawn = function patchedSpawn(command: string, argsOrOptions?: unknown, options?: unknown) {
    audit('spawn', String(command))
    // spawn(command, options) 与 spawn(command, args, options) 两种形态
    return Array.isArray(argsOrOptions)
      ? spawnOriginal.call(cp, command, argsOrOptions, withHidden(options))
      : spawnOriginal.call(cp, command, withHidden(argsOrOptions))
  }

  const execOriginal = cp.exec
  cp.exec = function patchedExec(command: string, optionsOrCallback?: unknown, callback?: unknown) {
    audit('exec', String(command))
    // exec(command, callback) 与 exec(command, options, callback) 两种形态
    return typeof optionsOrCallback === 'function'
      ? execOriginal.call(cp, command, withHidden(undefined), optionsOrCallback)
      : execOriginal.call(cp, command, withHidden(optionsOrCallback), callback)
  }

  const execFileOriginal = cp.execFile
  cp.execFile = function patchedExecFile(
    file: string,
    argsOrOptions?: unknown,
    optionsOrCallback?: unknown,
    callback?: unknown,
  ) {
    audit('execFile', String(file))
    if (Array.isArray(argsOrOptions)) {
      // execFile(file, args, callback) 与 execFile(file, args, options, callback)
      return typeof optionsOrCallback === 'function' || optionsOrCallback === undefined
        ? execFileOriginal.call(cp, file, argsOrOptions, withHidden(undefined), optionsOrCallback)
        : execFileOriginal.call(cp, file, argsOrOptions, withHidden(optionsOrCallback), callback)
    }
    // execFile(file, options, callback) 与 execFile(file, callback)
    return execFileOriginal.call(cp, file, withHidden(argsOrOptions), optionsOrCallback)
  }
}

function patchSyncApis(cp: any): void {
  const spawnSyncOriginal = cp.spawnSync
  cp.spawnSync = function patchedSpawnSync(command: string, argsOrOptions?: unknown, options?: unknown) {
    audit('spawnSync', String(command))
    return Array.isArray(argsOrOptions)
      ? spawnSyncOriginal.call(cp, command, argsOrOptions, withHidden(options))
      : spawnSyncOriginal.call(cp, command, withHidden(argsOrOptions))
  }

  const execSyncOriginal = cp.execSync
  cp.execSync = function patchedExecSync(command: string, options?: unknown) {
    audit('execSync', String(command))
    return execSyncOriginal.call(cp, command, withHidden(options))
  }

  const execFileSyncOriginal = cp.execFileSync
  cp.execFileSync = function patchedExecFileSync(file: string, argsOrOptions?: unknown, options?: unknown) {
    audit('execFileSync', String(file))
    return Array.isArray(argsOrOptions)
      ? execFileSyncOriginal.call(cp, file, argsOrOptions, withHidden(options))
      : execFileSyncOriginal.call(cp, file, withHidden(argsOrOptions))
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 安装包装
 *
 * 只在 Windows 生效：其他平台没有控制台窗口这回事，包装纯属多余开销。
 */
export function installHiddenConsoleGuard(): void {
  if (process.platform !== 'win32') return

  // default 导入指向模块的导出对象，属性可写；用它才能改到其它模块实际调用到的函数
  const cp = childProcess as unknown as Record<string, unknown> & Record<string, any>
  if (isPatched(cp)) return

  cp[PATCH_FLAG] = true
  patchAsyncApis(cp)
  patchSyncApis(cp)

  logger.system.info('[Spawn] Console window guard installed (windowsHide default on)')
}

installHiddenConsoleGuard()
