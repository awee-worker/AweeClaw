/**
 * Windows 常驻指针桥
 *
 * 每次注入都 spawn 一次 PowerShell 是远程鼠标与滚轮迟钝的根因：`Add-Type`
 * 每次都要现场编译一段 C# 才能拿到 user32 的入口，单次开销 150~400ms，
 * 远大于手指的采样间隔。滚动是最高频的操作，一屏文档要发几十条指令，
 * 这条通道直接决定了手感的物理上限。
 *
 * 这里改为启动一个长驻 PowerShell 进程，通过 stdin 逐行下发指令，由它直接
 * 调用 SetCursorPos / mouse_event。进程只编译一次，之后每条指令是微秒级。
 *
 * 桥不可用（进程被杀、Add-Type 被安全策略拦下）时返回 false，由调用方降级到
 * 原有的 spawn 通道——那条路慢，但一定能出结果，不会让远程控制彻底失效。
 */

import * as cp from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 桥进程执行的 PowerShell 脚本
 *
 * 指令协议（一行一条，空格分隔）：
 *   M x y                    移动到 (x, y)
 *   S x y notches            在 (x, y) 滚动，notches 正值向下
 *   C x y button times       在 (x, y) 点击，button 0/1/2 = 左/右/中
 *   G x1 y1 x2 y2 button     从 (x1, y1) 拖到 (x2, y2)
 *   P                        就绪探测，回一行 OK
 *   Q                        主动退出
 *
 * 按钮用数字而不是名字：PowerShell 的字符串比较在热路径上会多一次类型转换，
 * 而这条通道每秒要跑几十条指令。
 *
 * 每条指令单独 try 包裹：一条非法参数不能把整个桥带崩，否则一次异常就退化成
 * 每帧 spawn 的旧通道，而用户只会觉得「卡了一下之后再也没恢复」。
 */
const BRIDGE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class AweeClawPointer {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT p);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  public static string CursorPos() {
    POINT p;
    GetCursorPos(out p);
    return p.X + "," + p.Y;
  }

  private const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  private const uint RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
  private const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040;
  private const uint WHEEL = 0x0800;

  private static void Flags(int button, out uint down, out uint up) {
    if (button == 1) { down = RIGHTDOWN; up = RIGHTUP; return; }
    if (button == 2) { down = MIDDLEDOWN; up = MIDDLEUP; return; }
    down = LEFTDOWN; up = LEFTUP;
  }

  public static void Move(int x, int y) {
    SetCursorPos(x, y);
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y);
    // unchecked：notches 为负时按补码传进去，正是 Win32 期望的向上滚动
    mouse_event(WHEEL, 0, 0, unchecked((uint)(notches * 120)), UIntPtr.Zero);
  }

  public static void Click(int x, int y, int button, int times) {
    SetCursorPos(x, y);
    uint down, up;
    Flags(button, out down, out up);
    for (int i = 0; i < times; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
    }
  }

  public static void Drag(int x1, int y1, int x2, int y2, int button) {
    SetCursorPos(x1, y1);
    uint down, up;
    Flags(button, out down, out up);
    mouse_event(down, 0, 0, 0, UIntPtr.Zero);
    SetCursorPos(x2, y2);
    mouse_event(up, 0, 0, 0, UIntPtr.Zero);
  }
}
'@

// UI Automation 只服务滚动位置探针：加载失败时滑块退化为静态锚点，
// 不影响输入注入，因此单独 try 而不让异常穿出去
$uiaReady = $false
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $uiaReady = $true
} catch { }

$out = [Console]::Out
$out.WriteLine('READY')
$out.Flush()

$stdin = [Console]::In
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }
  if ($line -eq 'Q') { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'M' { [AweeClawPointer]::Move([int]$p[1], [int]$p[2]) }
      'S' { [AweeClawPointer]::Scroll([int]$p[1], [int]$p[2], [int]$p[3]) }
      'C' { [AweeClawPointer]::Click([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4]) }
      'G' { [AweeClawPointer]::Drag([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], [int]$p[5]) }
      'P' { $out.WriteLine('READY'); $out.Flush() }
      'V' {
        // 前置窗口的垂直滚动百分比（0~100），拿不到回 NA
        // 优先取指针所在元素：滚轮作用在指针处，探针必须与它一致，
        // 否则焦点停在功能区时读到的是另一块区域（或完全读不到）
        $res = 'NA'
        if ($uiaReady) {
          try {
            $el = $null
            $cp = [AweeClawPointer]::CursorPos().Split(',')
            $pt = [System.Windows.Point]::new([int]$cp[0], [int]$cp[1])
            $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
            if (-not $el) { $el = [System.Windows.Automation.AutomationElement]::FocusedElement }
            $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
            $depth = 0
            while ($el -and $depth -lt 12) {
              $pat = $null
              if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pat)) {
                $pct = $pat.Current.VerticalScrollPercent
                if ($pat.Current.VerticallyScrollable -and $pct -ge 0) {
                  $res = [int]$pct
                  break
                }
              }
              $el = $walker.GetParent($el)
              $depth++
            }
          } catch { }
        }
        $out.WriteLine("V:$res")
        $out.Flush()
      }
    }
  } catch { }
}
`

/** 桥进程句柄；null 表示尚未启动或已退出 */
let bridge: cp.ChildProcess | null = null
/**
 * 桥是否已完成初始化
 *
 * 进程 spawn 成功不等于能用：`Add-Type` 还要编译一次 C#，这段时间里写进 stdin
 * 的指令会排在管道里等待。用 PowerShell 回写的 OK 作为真正的就绪信号——
 * 在它到达之前一律降级到旧通道，用户不必等编译。
 */
let ready = false
/** 退出钩子只注册一次 */
let exitHookBound = false
/** stderr 仅保留最近一段，用于失败时定位原因 */
let lastStderr = ''

/**
 * 确保桥进程在运行
 *
 * stdin 已销毁或进程已退出时重建。这里只看句柄状态，不做健康探测：
 * 真正的健康信号是 write 是否报错，那比任何探测都准。
 */
function ensureBridge(): cp.ChildProcess | null {
  if (bridge && bridge.exitCode === null && !bridge.killed && bridge.stdin?.writable) {
    return bridge
  }

  try {
    // -EncodedCommand：脚本里有换行、引号与 here-string，直接拼进命令行会被
    // cmd 与 PowerShell 两层转义规则反复咀嚼，必然出错；UTF-16LE base64 是
    // Windows 官方为「传复杂脚本」留下的口子，不需要任何转义
    const encoded = Buffer.from(BRIDGE_SCRIPT, 'utf16le').toString('base64')
    const child = cp.spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )

    ready = false
    lastStderr = ''
    let buf = ''

    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line === 'READY') {
          ready = true
          continue
        }
        // 探针回执：V:<0~100|NA>
        if (line.startsWith('V:')) {
          const raw = line.slice(2)
          const pct = raw === 'NA' ? Number.NaN : Number(raw)
          settleProbe(Number.isFinite(pct) ? pct / 100 : null)
        }
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      lastStderr = (lastStderr + d.toString()).slice(-1000)
    })
    // 桥是「用完即弃」的辅助通道，任何退出都只清理句柄，不影响主流程
    child.on('exit', () => {
      if (bridge === child) {
        bridge = null
        ready = false
      }
      // 在途探针跟着一起收尾：等超时再结束只会让滑块停在旧值上
      settleProbe(null)
    })
    child.on('error', (err) => {
      logger.desktop.warn(`[WinPointerBridge] spawn failed: ${err.message}`)
      if (bridge === child) {
        bridge = null
        ready = false
      }
    })
    // stdin 的 EPIPE 不走 'error' 也得兜住，否则会变成未捕获异常
    child.stdin?.on('error', (err) => {
      logger.desktop.warn(`[WinPointerBridge] stdin error: ${err.message}`)
      if (bridge === child) {
        bridge = null
        ready = false
      }
    })

    bridge = child

    if (!exitHookBound) {
      exitHookBound = true
      process.once('exit', () => {
        try {
          bridge?.stdin?.end()
          bridge?.kill()
        } catch {
          // 进程退出阶段，失败无所谓
        }
      })

    }

    logger.desktop.info('[WinPointerBridge] starting')
    return child
  } catch (err) {
    logger.desktop.warn(`[WinPointerBridge] start failed: ${(err as Error).message}`)
    return null
  }
}

/**
 * 异步下发一条指令
 *
 * 失败返回 false，调用方据此降级到 spawn 通道。写成功不代表执行成功：
 * 桥是单向通道，不为每帧等待回执——等回执就等于退回串行 RPC 的老问题。
 */
export function sendPointerCommand(line: string): boolean {
  const child = ensureBridge()
  if (!child || !ready || !child.stdin || !child.stdin.writable) return false
  try {
    child.stdin.write(`${line}\n`)
    return true
  } catch (err) {
    logger.desktop.warn(`[WinPointerBridge] write failed: ${(err as Error).message}`)
    return false
  }
}

/** 移动指针 */
export function bridgeMove(x: number, y: number): boolean {
  return sendPointerCommand(`M ${x} ${y}`)
}

/** 点击指针 */
export function bridgeClick(
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle',
  clickType: 'single' | 'double',
): boolean {
  const code = button === 'right' ? 1 : button === 'middle' ? 2 : 0
  return sendPointerCommand(`C ${x} ${y} ${code} ${clickType === 'double' ? 2 : 1}`)
}

/** 拖拽一段 */
export function bridgeDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  button: 'left' | 'right' | 'middle',
): boolean {
  const code = button === 'right' ? 1 : button === 'middle' ? 2 : 0
  return sendPointerCommand(`G ${fromX} ${fromY} ${toX} ${toY} ${code}`)
}

/** 滚动 */
export function bridgeScroll(x: number, y: number, amount: number): boolean {
  return sendPointerCommand(`S ${x} ${y} ${amount}`)
}

/** 桥当前是否已就绪（不启动新进程，只读状态） */
export function isBridgeReady(): boolean {
  return ready && Boolean(bridge && bridge.exitCode === null && !bridge.killed)
}

/** 最近一次 stderr 片段，供失败日志定位 */
export function bridgeStderr(): string {
  return lastStderr
}

// ---------------------------------------------------------------------------
// 滚动位置探针
// ---------------------------------------------------------------------------

/**
 * 探针的在途回调
 *
 * 桥是单向通道，只有探针这一项需要回执。同一时刻只允许一条在途：两条并发时
 * 回执无法与请求配对，宁可直接返回 null——调用方有节流，下一次很快就会到。
 */
let probeSettle: ((value: number | null) => void) | null = null
let probeTimer: ReturnType<typeof setTimeout> | null = null

function settleProbe(value: number | null) {
  if (probeTimer) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
  const resolve = probeSettle
  probeSettle = null
  resolve?.(value)
}

/**
 * 读指针所在窗口的垂直滚动百分比
 *
 * 返回 0~1；null 表示当前指针或焦点处没有可滚动区域，或者桥未就绪。
 * 超时兜底是必须的：UIA 跨进程调用遇到无响应的程序时会长时间挂住，
 * 不设超时会让探针从此不再返回，滑块永远停在旧值上。
 */
export function requestScrollPercent(timeoutMs = 600): Promise<number | null> {
  if (!isBridgeReady() || probeSettle) return Promise.resolve(null)
  return new Promise((resolve) => {
    probeSettle = resolve
    probeTimer = setTimeout(() => settleProbe(null), timeoutMs)
    if (!sendPointerCommand('V')) settleProbe(null)
  })
}

