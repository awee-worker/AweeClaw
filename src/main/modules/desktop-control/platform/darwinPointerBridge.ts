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
  "ObjC.import('ApplicationServices');",
  'function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }',
  'function pt(x, y) { return $.CGPointMake(num(x), num(y)); }',
  'function post(ev) { $.CGEventPost($.kCGHIDEventTap, ev); }',
  'function moveTo(x, y) { post($.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt(x, y), 0)); }',
  'function outLine(s) { $.NSFileHandle.fileHandleWithStandardOutput.writeData($(s + "\\n").dataUsingEncoding($.NSUTF8StringEncoding)); }',
  'function axAttr(el, name) {',
  '  if (!el) return null;',
  '  var out = Ref();',
  '  var err = $.AXUIElementCopyAttributeValue(el, $(name), out);',
  '  if (err !== 0 || !out[0]) return null;',
  '  return out[0];',
  '}',
  'function axRole(el) {',
  '  var r = axAttr(el, "AXRole");',
  '  return r ? String(r) : "";',
  '}',
  // AX 树是跨进程访问，每次读取都有 IPC 开销，所以限制广度优先的访问预算；
  // 超过预算就放弃：拿不到位置时上游会退回静态锚点，比卡住好
  'function findScrollBar() {',
  '  var app = axAttr($.AXUIElementCreateSystemWide(), "AXFocusedApplication");',
  '  if (!app) return null;',
  '  var win = axAttr(app, "AXFocusedWindow") || axAttr(app, "AXMainWindow");',
  '  if (!win) return null;',
  '  var queue = [win];',
  '  var budget = 300;',
  '  while (queue.length > 0 && budget-- > 0) {',
  '    var el = queue.shift();',
  '    if (axRole(el) === "AXScrollArea") {',
  '      var bar = axAttr(el, "AXVerticalScrollBar");',
  '      if (bar && axRole(bar) === "AXScrollBar") return bar;',
  '    }',
  '    var kids = axAttr(el, "AXChildren");',
  '    if (kids) {',
  '      var n = (kids.count !== undefined) ? kids.count : (kids.length || 0);',
  '      for (var i = 0; i < n; i++) {',
  '        queue.push(kids.objectAtIndex ? kids.objectAtIndex(i) : kids[i]);',
  '      }',
  '    }',
  '  }',
  '  return null;',
  '}',
  // 滚动条的 AXValue 就是 0~1 的归一化位置，直接可用，不需要再估算文档高度
  'function readScrollPercent() {',
  '  var bar = null;',
  '  try { bar = findScrollBar(); } catch (e) { return null; }',
  '  if (!bar) return null;',
  '  var v = axAttr(bar, "AXValue");',
  '  if (v === null || v === undefined) return null;',
  '  var num2 = Number(v);',
  '  if (isNaN(num2) || num2 < 0 || num2 > 1) return null;',
  '  return num2;',
  '}',
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
  "  if (op === 'V') {",
  '    var pct = readScrollPercent();',
  '    outLine("V:" + (pct === null ? "NA" : Math.round(pct * 100)));',
  '    return;',
  '  }',
  '}',
  'var input = $.NSFileHandle.fileHandleWithStandardInput;',
  "var buf = '';",
  'var quit = false;',
  'while (!quit) {',
  '  var data = input.availableData;',
  'outLine("READY");',
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
/**
 * 桥是否已完成初始化
 *
 * spawn 成功不等于能用：osascript 要先编译整段 JXA。用脚本自己回写的 READY
 * 作为就绪信号——在它到达之前，探针请求直接判为不可用。
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
    const child = cp.spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', BRIDGE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
      logger.desktop.warn(`[PointerBridge] spawn failed: ${err.message}`)
      if (bridge === child) {
        bridge = null
        ready = false
      }
    })
    // stdin 的 EPIPE 不走 'error' 也得兜住，否则会变成未捕获异常
    child.stdin?.on('error', (err) => {
      logger.desktop.warn(`[PointerBridge] stdin error: ${err.message}`)
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

// ---------------------------------------------------------------------------
// 滚动位置探针
// ---------------------------------------------------------------------------

/**
 * 探针的在途回调
 *
 * 桥是单向通道，只有探针需要回执。同一时刻只允许一条在途：两条并发时回执
 * 无法与请求配对，宁可直接返回 null——调用方有节流，下一次很快就到。
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
 * 读前台窗口的垂直滚动百分比
 *
 * macOS 侧当前不启用，原因是实测结论而非保守估计：JXA 经 ObjC bridge 调
 * AXUIElementCopyAttributeValue 时，返回的 CFTypeRef 无法再传回下一个 AX 调用，
 * 属性值表现为 [object Ref]、继续遍历直接报 -2700 类型错误（辅助功能权限本身是
 * 已授予的）。要在 macOS 上拿到滚动条位置，只能打包一个原生 Swift helper，
 * 成本远高于这个指示器本身的价值。
 *
 * 因此这里直接返回 null，移动端滑块退回「可拖拽」的静态锚点——它不冒充进度。
 *
 * 脚本里的 V 指令分支保留：语法正确且不参与执行，将来原生 helper 落地后可以
 * 直接接上，不必重写桥的协议。
 */
export function requestScrollPercent(_timeoutMs = 800): Promise<number | null> {
  return Promise.resolve(null)
}

