/**
 * 防休眠平台实现（主进程）
 *
 * 三种机制：
 *   macOS    `caffeinate`（系统自带，`-w <pid>` 绑定父进程，父进程崩溃即自动释放）
 *   Linux    `systemd-inhibit`（常驻子进程；无 systemd 时如实上报不支持，见 types.ts 说明）
 *   Windows  PowerShell 内联 P/Invoke `SetThreadExecutionState`（常驻子进程持有断言）
 *
 * ── 为什么统一用「常驻子进程」而不是「调用一次 API」 ──
 *
 * 三个平台的断言都是**进程/线程级**的：进程一退，断言自动消失。这让「应用被强杀」
 * 这个最坏情况天然安全 —— 不会出现「AweeClaw 已经没了但系统还是睡不了」。
 * 反过来，如果走「改变系统全局设置」的路线（如 `powercfg /change`），就必须保证
 * 每个退出路径都能回滚，任何一次崩溃都会永久留下副作用，这是不可接受的。
 *
 * `PowerGuardStore` 里的 `guard.json` 只针对**唯一**会残留的场景：systemd-inhibit
 * 没有 `-w` 等价物，父进程被 SIGKILL 后它仍会活着。启动时按该记录定向清理。
 *
 * @module power-guard/PowerGuardPlatform
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'
import type { PowerGuardPlatformKind, PowerGuardSource } from './types'

/** 强度（`off` 不会走到平台层） */
type ActiveMode = 'idle' | 'system'

/** 平台守护句柄 */
export interface GuardStartResult {
  /** 守护子进程 pid（拿不到时为 null） */
  pid: number | null
  /** 生效机制 */
  kind: PowerGuardSource
  /** **实际**生效的强度（降级时可能与请求的强度不同） */
  effectiveMode: ActiveMode
  /** 降级说明（未降级时为空串） */
  downgraded: string
}

/** 平台守卫接口 */
export interface PlatformGuard {
  readonly platform: PowerGuardPlatformKind
  /** 当前机制名（未启动时为 'none'） */
  readonly kind: PowerGuardSource
  /** 该平台是否有可用机制 */
  supported(): boolean
  /** 不支持的原因（`supported() === false` 时非空，用于 UI 如实告知） */
  unsupportedReason(): string
  /** 启动守护（失败时抛错，错误消息面向用户可读） */
  start(mode: ActiveMode): Promise<GuardStartResult>
  /** 停止守护（幂等；失败不抛错，只记日志） */
  stop(): Promise<void>
  /** 守护子进程是否仍活着 */
  isAlive(): boolean
}

// ============================================
// 通用工具
// ============================================

/**
 * 启动一个「应当长期存活」的子进程。
 *
 * 关键点：`spawn` 的失败有两种形态 ——
 *   1. 命令不存在 → 走 `error` 事件（ENOENT）
 *   2. 命令存在但参数非法 / 内部报错 → 立刻 `exit`
 * 只监听 `error` 会把第 2 种当成成功。
 *
 * 因此这里给一个「存活观察窗口」：窗口内退出视为失败，窗口结束仍活着才算成功。
 * 窗口长度按平台给（PowerShell 要等 Add-Type 编译完才可能报错，需要更长的窗口）。
 */
function spawnPersistent(
  command: string,
  args: string[],
  settleMs: number,
): Promise<{ child: ChildProcess; pid: number | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, {
        stdio: 'ignore',
        windowsHide: true,
        // 不继承 Electron 的信号量与 stdin；子进程独立于父进程的 stdio 生命周期
        detached: false,
      })
    } catch (err) {
      reject(new Error(`${command} 启动失败：${err instanceof Error ? err.message : String(err)}`))
      return
    }

    let settled = false

    const fail = (reason: string): void => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      reject(new Error(reason))
    }

    child.once('error', (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code
      fail(code === 'ENOENT' ? `未找到 ${command}` : `${command} 启动异常：${err.message}`)
    })

    child.once('exit', (code, signal) => {
      fail(`${command} 启动后立即退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`)
    })

    setTimeout(() => {
      if (settled) return
      settled = true
      // 窗口结束后移除 exit 监听：之后退出属于「运行期异常退出」，由 isAlive 反映，
      // 不该再走启动失败路径
      child.removeAllListeners('exit')
      resolve({ child, pid: child.pid ?? null })
    }, settleMs)
  })
}

/** 进程是否存活（跨平台，`kill(pid, 0)` 语义） */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM 说明进程存在但无权限（不该发生在同用户子进程上，但保守视为存活）
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 读取进程的可执行名，用于残留清理时**二次确认**目标身份。
 *
 * 只凭 pid 杀进程是危险的（pid 会被复用）。这里要求「pid 存活」+
 * 「进程名匹配预期」两个条件同时成立才动手，把误杀窗口压到可忽略。
 */
export function readProcessCommand(pid: number): string {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf-8',
        windowsHide: true,
      })
      return (out.stdout || '').trim()
    }
    const out = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8' })
    return (out.stdout || '').trim()
  } catch {
    return ''
  }
}

/** 终止进程（跨平台；失败静默，交由调用方决定是否升级处理） */
export function killProcess(pid: number, force = false): boolean {
  if (!pid || pid <= 0) return false
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
        encoding: 'utf-8',
        windowsHide: true,
      })
      return out.status === 0
    }
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return true
  } catch {
    return false
  }
}

/** 等待子进程退出（带超时），超时后升级为强杀 */
function terminateChild(child: ChildProcess | null, graceMs = 1500): Promise<void> {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }

    const done = (): void => {
      clearTimeout(forceTimer)
      child.removeAllListeners('exit')
      resolve()
    }

    child.once('exit', done)

    const forceTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      // 强杀后再给一小段时间让 exit 事件落地；即便没落地也不再阻塞调用方
      setTimeout(done, 200)
    }, graceMs)

    try {
      child.kill('SIGTERM')
    } catch {
      done()
    }
  })
}

// ============================================
// macOS：caffeinate
// ============================================

/**
 * caffeinate 参数映射。
 *
 *   -i  阻止**系统空闲休眠** → 产生 `PreventUserIdleSystemSleep` 断言
 *   -d  阻止**显示器休眠**   → 产生 `PreventUserIdleDisplaySleep` 断言
 *
 * `idle` 只给 `-i`：后台长任务没必要让屏幕常亮（笔记本用户会在意耗电）。
 * `system` 给 `-i -d`：演示 / 直播场景下屏幕熄灭等于任务失败。
 *
 * ⚠️ **刻意不用 `-s`**（源项目用的 `-dims` 含它）。
 * `-s` 产生 `PreventSystemSleep`，而该断言「仅在接通电源时有效」——真机探针显示它在
 * AC 供电下一切正常，但按 Apple 的实现，断言创建失败时 `caffeinate` 会**直接退出并返回失败**，
 * 于是电池供电的笔记本上 `system` 档会变成「完全没有保护」，比只给 `-i -d` 更糟。
 * 而 `-i` 已经覆盖了「空闲不睡」这一真正要防的场景，`-s` 只在「非空闲触发的睡眠」上
 * 多挡一层，收益远小于它带来的全盘失败风险。
 *
 * 真机探针（macOS，`pmset -g assertions`）实测：
 *   `-i`      → PreventUserIdleSystemSleep ✅
 *   `-i -d`   → PreventUserIdleSystemSleep + PreventUserIdleDisplaySleep ✅
 *   `-i -d -s`→ 上述 + PreventSystemSleep（AC 下成功，电池下不保证）
 *   kill 后三种情况的断言全部立即消失、无残留 ✅
 */
const CAFFEINATE_FLAGS: Record<ActiveMode, string[]> = {
  idle: ['-i'],
  system: ['-i', '-d'],
}

class CaffeinateGuard implements PlatformGuard {
  readonly platform = 'darwin' as const
  kind: PowerGuardSource = 'none'

  private child: ChildProcess | null = null

  supported(): boolean {
    return true
  }

  unsupportedReason(): string {
    return ''
  }

  async start(mode: ActiveMode): Promise<GuardStartResult> {
    await this.stop()

    // `-w <pid>` 是进程守护的核心：caffeinate 会等到该 pid 退出后自动结束。
    // 有了它，即便 AweeClaw 被 SIGKILL，断言也会在毫秒级内释放，
    // 这是 macOS 侧残留清理的**第一道**（也是主要）保障。
    const args = [...CAFFEINATE_FLAGS[mode], '-w', String(process.pid)]

    const { child, pid } = await spawnPersistent('/usr/bin/caffeinate', args, 150)
    this.child = child
    this.kind = 'caffeinate'
    return { pid, kind: 'caffeinate', effectiveMode: mode, downgraded: '' }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.kind = 'none'
    await terminateChild(child)
  }

  isAlive(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null
  }
}

// ============================================
// Linux：systemd-inhibit
// ============================================

/**
 * systemd-inhibit 的 `--what` 映射。
 *
 * systemd 的抑制剂分类里**没有**「显示器」这一项（显示熄灭由桌面环境自己管），
 * 因此 Linux 下 `system` 模式能多挡的只有 `sleep`（真正的系统睡眠），
 * 显示器关闭无法通过本机制阻止 —— 这一点必须在 UI 里说明，不能假装做到了。
 */
const SYSTEMD_INHIBIT_WHAT: Record<ActiveMode, string> = {
  idle: 'idle',
  system: 'idle:sleep',
}

class SystemdInhibitGuard implements PlatformGuard {
  readonly platform = 'linux' as const
  kind: PowerGuardSource = 'none'

  private child: ChildProcess | null = null
  private unavailable = ''

  supported(): boolean {
    if (this.unavailable) return false
    const probe = spawnSync('sh', ['-c', 'command -v systemd-inhibit'], { encoding: 'utf-8' })
    if (probe.status === 0 && (probe.stdout || '').trim()) return true
    this.unavailable = '未检测到 systemd-inhibit（当前系统可能不是 systemd 启动），无法在本平台阻止休眠'
    return false
  }

  unsupportedReason(): string {
    return this.unavailable
  }

  async start(mode: ActiveMode): Promise<GuardStartResult> {
    await this.stop()

    const args = [
      `--what=${SYSTEMD_INHIBIT_WHAT[mode]}`,
      '--who=AweeClaw',
      '--why=AweeClaw 任务运行中，需阻止系统休眠',
      '--mode=block',
      'sleep',
      'infinity',
    ]

    const { child, pid } = await spawnPersistent('systemd-inhibit', args, 300)
    this.child = child
    this.kind = 'systemd-inhibit'
    return { pid, kind: 'systemd-inhibit', effectiveMode: mode, downgraded: '' }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.kind = 'none'
    await terminateChild(child)
  }

  isAlive(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null
  }
}

// ============================================
// Windows：SetThreadExecutionState
// ============================================

/**
 * Windows 侧没有 CLI 等价物，必须调 Win32 API。
 *
 * Node 无法直接 P/Invoke，因此起一个常驻 PowerShell：
 *   1. `Add-Type` 内联编译一段 C#，声明 `SetThreadExecutionState`
 *   2. 调用一次设置断言（`ES_CONTINUOUS | ES_SYSTEM_REQUIRED [| ES_DISPLAY_REQUIRED]`）
 *   3. 空转保持进程存活 —— 断言绑定在线程上，进程一退即被系统清除
 *
 * 用 `-EncodedCommand`（UTF-16LE + Base64）传脚本，彻底绕开引号 / 换行 / 中文
 * 在 `-Command` 里的转义地狱（这是 PowerShell 嵌入脚本最常见的翻车点）。
 */
const ES_CONTINUOUS = 0x80000000
const ES_SYSTEM_REQUIRED = 0x00000001
const ES_DISPLAY_REQUIRED = 0x00000002

/** 断言定义 + 常驻空转（模式差异由占位符替换） */
const POWERSHELL_TEMPLATE = `$ErrorActionPreference='Stop'
$src='using System;using System.Runtime.InteropServices;public static class AweeClawPowerGuardHost{[DllImport("kernel32.dll",SetLastError=true)]public static extern uint SetThreadExecutionState(uint esFlags);}'
Add-Type -TypeDefinition $src -Language CSharp
$flags=[uint32]__FLAGS__
$r=[AweeClawPowerGuardHost]::SetThreadExecutionState($flags)
if($r -eq 0){ Write-Error 'SetThreadExecutionState failed'; exit 1 }
while($true){ Start-Sleep -Seconds 20 }`

class WindowsExecutionStateGuard implements PlatformGuard {
  readonly platform = 'win32' as const
  kind: PowerGuardSource = 'none'

  private child: ChildProcess | null = null

  supported(): boolean {
    return true
  }

  unsupportedReason(): string {
    return ''
  }

  async start(mode: ActiveMode): Promise<GuardStartResult> {
    await this.stop()

    let flags = (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0
    if (mode === 'system') flags = (flags | ES_DISPLAY_REQUIRED) >>> 0

    const script = POWERSHELL_TEMPLATE.replace('__FLAGS__', String(flags))
    const encoded = Buffer.from(script, 'utf16le').toString('base64')

    const { child, pid } = await spawnPersistent(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      // 窗口给足：Add-Type 首次编译需要几百毫秒，太短会把「编译失败」误判成成功
      2000,
    )

    this.child = child
    this.kind = 'powershell'
    return { pid, kind: 'powershell', effectiveMode: mode, downgraded: '' }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.kind = 'none'
    await terminateChild(child)
  }

  isAlive(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null
  }
}

// ============================================
// 不支持平台
// ============================================

class UnsupportedGuard implements PlatformGuard {
  readonly platform = 'unsupported' as const
  kind: PowerGuardSource = 'none'

  supported(): boolean {
    return false
  }

  unsupportedReason(): string {
    return `当前平台（${process.platform}）没有可用的防休眠机制`
  }

  async start(): Promise<GuardStartResult> {
    throw new Error(this.unsupportedReason())
  }

  async stop(): Promise<void> {
    /* 无守护进程 */
  }

  isAlive(): boolean {
    return false
  }
}

// ============================================
// 工厂
// ============================================

/** 当前平台标识 */
export function detectPlatform(): PowerGuardPlatformKind {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'linux') return 'linux'
  if (process.platform === 'win32') return 'win32'
  return 'unsupported'
}

/** 按当前平台创建守卫实现 */
export function createPlatformGuard(): PlatformGuard {
  switch (detectPlatform()) {
    case 'darwin':
      return new CaffeinateGuard()
    case 'linux':
      return new SystemdInhibitGuard()
    case 'win32':
      return new WindowsExecutionStateGuard()
    default:
      logger.system.warn(`[PowerGuard] 平台 ${process.platform} 无可用实现`)
      return new UnsupportedGuard()
  }
}

/**
 * 判断某个 pid 是否「看起来就是该机制的守护进程」。
 *
 * 残留清理前的二次确认：pid 复用是真实存在的（尤其重启后 pid 回绕），
 * 只凭 pid 杀进程有可能误杀用户自己的程序。加上进程名匹配后，
 * 误杀需要同时满足「pid 恰好复用」+「新进程恰好是同名机制」两个巧合。
 */
export function matchesGuardSignature(pid: number, kind: PowerGuardSource): boolean {
  const command = readProcessCommand(pid).toLowerCase()
  if (!command) return false

  switch (kind) {
    case 'caffeinate':
      return command.includes('caffeinate')
    case 'systemd-inhibit':
      return command.includes('systemd-inhibit')
    case 'powershell':
      // EncodedCommand 是 Base64，命令行里看不到脚本内容，只能靠进程名判断。
      // 内容无法校验，因此额外要求 pid 精确匹配（由调用方保证）。
      return command.includes('powershell') || command.includes('pwsh')
    default:
      return false
  }
}
