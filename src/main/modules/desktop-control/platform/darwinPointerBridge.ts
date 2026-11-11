/**
 * macOS 常驻指针桥
 *
 * 每次移动都 spawn 一次 osascript（或 cliclick）是远程鼠标「一顿一顿」的根因：
 * 进程启动本身要 100~250ms，远大于手指的滑动采样间隔，于是光标永远追着手指跑。
 *
 * 这里改为启动一个长驻 JXA 进程，通过 stdin 逐行下发指令，由它直接 CGEventPost。
 * 单进程按行串行执行，顺带解决另一个隐患：并发 spawn 时多个进程的完成顺序不定，
 * 迟到的旧移动会覆盖新位置，用户表现就是「滑到位了，点下去却点偏」。
 *
 * 桥不可用（进程被杀、stdin 断开）时返回 false，由调用方降级到原有 spawn 通道。
 */

import * as cp from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 桥进程执行的 JXA 脚本
 *
 * 指令协议（一行一条，空格分隔）：
 *   M x y                       移动到 (x, y)
 *   C x y button single|double  在 (x, y) 点击
 *   G x1 y1 x2 y2 button        从 (x1, y1) 拖到 (x2, y2)
 *   S x y amount                在 (x, y) 滚动，amount 正值向下
 *   Q                           主动退出
 *
 * 逐行 try 包裹：单条指令失败不能把整个桥带崩，否则一次异常就退化成每帧 spawn。
 */
const BRIDGE_SCRIPT = [
  "ObjC.import('Foundation');",
  "ObjC.import('CoreGraphics');",
  'function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }',
  'function pt(x, y) { return $.CGPointMake(num(x), num(y)); }',
  'function post(ev) { $.CGEventPost($.kCGHIDEventTap, ev); }',
  'function moveTo(x, y) { post($.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt(x, y), 0)); }',
  'function btn(name) {',
  "  if (name === 'right') return [$.kCGEventRightMouseDown, $.kCGEventRightMouseUp, $.kCGMouseButtonRight];",
  "  if (name === 'middle') return [$.kCGEventOtherMouseDown, $.kCGEventOtherMouseUp, 2];",
  '  return [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp, $.kCGMouseButtonLeft];',
  '}',
  'function handle(line) {',
  "  var p = line.split(' ');",
  '  var op = p[0];',
  "  if (op === 'M') { moveTo(p[1], p[2]); return; }",
  "  if (op === 'C') {",
  "    var b = btn(p[3] || 'left');",
  "    var times = (p[4] === 'double') ? 2 : 1;",
  '    moveTo(p[1], p[2]);',
  '    for (var i = 0; i < times; i++) {',
  '      post($.CGEventCreateMouseEvent(null, b[0], pt(p[1], p[2]), b[2]));',
  '      post($.CGEventCreateMouseEvent(null, b[1], pt(p[1], p[2]), b[2]));',
  '    }',
  '    return;',
  '  }',
  "  if (op === 'G') {",
  "    var g = btn(p[5] || 'left');",
  '    post($.CGEventCreateMouseEvent(null, g[0], pt(p[1], p[2]), g[2]));',
  '    post($.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt(p[3], p[4]), 0));',
  '    post($.CGEventCreateMouseEvent(null, g[1], pt(p[3], p[4]), g[2]));',
  '    return;',
  '  }',
  "  if (op === 'S') {",
  '    moveTo(p[1], p[2]);',
  '    post($.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 1, -num(p[3])));',
  '    return;',
  '  }',
  '}',
  'var input = $.NSFileHandle.fileHandleWithStandardInput;',
  "var buf = '';",
  'var quit = false;',
  'while (!quit) {',
  '  var data = input.availableData;',
  '  if (!data || data.length === 0) break;',
  '  var chunk = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));',
  '  if (!chunk) continue;',
  '  buf += chunk;',
  '  var idx;',
  "  while ((idx = buf.indexOf('\\n')) >= 0) {",
  '    var line = buf.slice(0, idx).trim();',
  '    buf = buf.slice(idx + 1);',
  "    if (!line) continue;",
  "    if (line === 'Q') { quit = true; break; }",
  '    try { handle(line); } catch (e) {}',
  '  }',
  '}',
].join('\n')

/** 桥进程句柄；null 表示尚未启动或已退出 */
let bridge: cp.ChildProcess | null = null
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
    const child = cp.spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', BRIDGE_SCRIPT], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    lastStderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      lastStderr = (lastStderr + d.toString()).slice(-1000)
    })
    // 桥是「用完即弃」的辅助通道，任何退出都只清理句柄，不影响主流程
    child.on('exit', () => {
      if (bridge === child) bridge = null
    })
    child.on('error', (err) => {
      logger.desktop.warn(`[PointerBridge] spawn failed: ${err.message}`)
      if (bridge === child) bridge = null
    })
    // stdin 的 EPIPE 不走 'error' 也得兜住，否则会变成未捕获异常
    child.stdin?.on('error', (err) => {
      logger.desktop.warn(`[PointerBridge] stdin error: ${err.message}`)
      if (bridge === child) bridge = null
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

    logger.desktop.info('[PointerBridge] started')
    return child
  } catch (err) {
    logger.desktop.warn(`[PointerBridge] start failed: ${(err as Error).message}`)
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
  if (!child || !child.stdin || !child.stdin.writable) return false
  try {
    child.stdin.write(`${line}\n`)
    return true
  } catch (err) {
    logger.desktop.warn(`[PointerBridge] write failed: ${(err as Error).message}`)
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
  return sendPointerCommand(`C ${x} ${y} ${button} ${clickType}`)
}

/** 拖拽一段 */
export function bridgeDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  button: 'left' | 'right' | 'middle',
): boolean {
  return sendPointerCommand(`G ${fromX} ${fromY} ${toX} ${toY} ${button}`)
}

/** 滚动 */
export function bridgeScroll(x: number, y: number, amount: number): boolean {
  return sendPointerCommand(`S ${x} ${y} ${amount}`)
}

/** 桥当前是否可用于判断降级（不启动新进程，只读状态） */
export function isBridgeAlive(): boolean {
  return Boolean(bridge && bridge.exitCode === null && !bridge.killed && bridge.stdin?.writable)
}

/** 最近一次 stderr 片段，供失败日志定位 */
export function bridgeStderr(): string {
  return lastStderr
}
