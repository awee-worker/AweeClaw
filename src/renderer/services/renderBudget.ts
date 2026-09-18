/**
 * 渲染预算调度 — 按运行状态收敛界面动效
 *
 * 会话区在 Agent 执行期间会同时挂上一批装饰性循环动画：思考块的竖条脉冲、光带
 * 下滑、指示点缩放，工具卡片的扫光与文本扫光，阶段指示灯，等待点……单个动画的
 * 开销都不高，但它们让合成器每帧都有活干，渲染进程再也回不到空闲帧。真正的代价
 * 出现在叠加处：
 *
 *   - 合成层数量随并发动画线性增长，流式输出时 DOM 频繁变更还会反复重建层树；
 *   - 停在 `overflow: hidden` + 圆角容器里的位移动画，每帧都要按圆角重新裁剪；
 *   - 走 `background-position` / SVG `stroke-dashoffset` 的动画属于绘制级，
 *     每帧要在主线程重新栅格化，这条路最贵。
 *
 * 所以这里不做「删动画」，而是给它一个统一开关，按环境收敛：
 *
 *   1. Agent 执行中 — 只留最低成本的运行提示，扫光与位移动画全部停掉；
 *   2. 窗口不可见   — 全部挂起，后台长任务不再空转；
 *   3. 实测掉帧     — 进一步退到静态，低配机器自动兜底。
 *
 * 三个开关写在 `<html>` 的 data 属性上，样式层用属性选择器统一接管。组件侧不需要
 * 感知开关状态，也不必逐个改 class，动效的取舍只在一个地方维护。
 *
 * 帧率采样只在 Agent 执行且页面可见时进行：空闲时一个 rAF 都不跑，避免为了省性能
 * 反而增加占用。
 *
 * @module services/renderBudget
 */

import { logger } from '@shared/toolkit/LogEngine'

/** Agent 执行中标记，对应 CSS 的 `html[data-agent-busy='1']` */
const ATTR_BUSY = 'agentBusy'
/** 窗口不可见标记，对应 CSS 的 `html[data-window-hidden='1']` */
const ATTR_HIDDEN = 'windowHidden'
/** 掉帧降级标记，对应 CSS 的 `html[data-perf-low='1']` */
const ATTR_LOW = 'perfLow'

/** 帧率评估窗口长度：约 1 秒 */
const SAMPLE_WINDOW_MS = 1000
/** 判定掉帧的平均帧间隔上限，约合 45fps */
const LOW_FRAME_MS = 22
/** 判定恢复流畅的平均帧间隔上限，约合 58fps */
const GOOD_FRAME_MS = 17
/** 连续多少次采样超标才降级 */
const LOW_CONFIRM = 2
/** 连续多少次采样达标才恢复 */
const GOOD_CONFIRM = 5
/** 降级后的观察冷却期，防止在阈值附近来回抖动 */
const RECOVER_COOLDOWN_MS = 10_000

let initialized = false
let visibilityBound = false

/**
 * 并发执行的任务数。
 *
 * 同一窗口里可能有多个线程同时跑 Agent（例如主会话与后台计划任务），标记必须等
 * 最后一个任务结束才撤销，否则先结束的那次会把仍在执行的界面动画重新放出来。
 */
let busyDepth = 0

let probeId = 0
let probeWindowStart = 0
let probeFrames = 0
let lowStreak = 0
let goodStreak = 0
let loweredAt = 0

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

/* ------------------------------------------------------------------ */
/* 帧率采样                                                            */
/* ------------------------------------------------------------------ */

function evaluate(avgFrameMs: number, now: number): void {
  const el = root()
  if (!el) return

  if (el.dataset[ATTR_LOW] !== '1') {
    lowStreak = avgFrameMs > LOW_FRAME_MS ? lowStreak + 1 : 0
    if (lowStreak < LOW_CONFIRM) return
    lowStreak = 0
    loweredAt = now
    el.dataset[ATTR_LOW] = '1'
    logger.system.debug(
      `[RenderBudget] 平均帧间隔 ${avgFrameMs.toFixed(1)}ms，装饰动效降级为静态`,
    )
    return
  }

  // 已经处在降级状态：门槛更高、观察期更长，否则动画一停帧率立刻回升，
  // 会把开关推回原状，界面就会在两种状态之间反复抖动。
  if (now - loweredAt < RECOVER_COOLDOWN_MS) return
  goodStreak = avgFrameMs < GOOD_FRAME_MS ? goodStreak + 1 : 0
  if (goodStreak < GOOD_CONFIRM) return
  goodStreak = 0
  delete el.dataset[ATTR_LOW]
  logger.system.debug(
    `[RenderBudget] 平均帧间隔 ${avgFrameMs.toFixed(1)}ms，装饰动效还原`,
  )
}

function probe(now: number): void {
  probeId = requestAnimationFrame(probe)

  if (probeWindowStart === 0) {
    probeWindowStart = now
    probeFrames = 0
    return
  }

  probeFrames += 1
  const elapsed = now - probeWindowStart
  if (elapsed < SAMPLE_WINDOW_MS) return

  const avgFrameMs = elapsed / probeFrames
  probeWindowStart = now
  probeFrames = 0
  evaluate(avgFrameMs, now)
}

function startProbe(): void {
  if (probeId !== 0 || typeof requestAnimationFrame !== 'function') return
  probeWindowStart = 0
  probeFrames = 0
  probeId = requestAnimationFrame(probe)
}

function stopProbe(): void {
  if (probeId === 0) return
  cancelAnimationFrame(probeId)
  probeId = 0
  probeWindowStart = 0
  probeFrames = 0
}

/* ------------------------------------------------------------------ */
/* 窗口可见性                                                          */
/* ------------------------------------------------------------------ */

function applyVisibility(): void {
  const el = root()
  if (!el) return

  if (document.hidden) {
    el.dataset[ATTR_HIDDEN] = '1'
    stopProbe()
    return
  }

  delete el.dataset[ATTR_HIDDEN]
  // 回到前台时仍在执行，就接着评估；空闲状态不重新开采样
  if (busyDepth > 0) startProbe()
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 初始化全局开关。
 *
 * 由应用根组件在挂载时调用；重复调用返回同一个清理函数，多入口窗口下也不会
 * 重复绑定监听。
 */
export function initRenderBudget(): () => void {
  if (initialized) return disposeRenderBudget
  initialized = true

  const el = root()
  if (!el) {
    initialized = false
    return () => {}
  }

  // 首次进入时窗口可能已经是隐藏的（例如后台启动），先落一次真实状态
  if (document.hidden) el.dataset[ATTR_HIDDEN] = '1'

  document.addEventListener('visibilitychange', applyVisibility)
  visibilityBound = true

  return disposeRenderBudget
}

function disposeRenderBudget(): void {
  if (!initialized) return
  initialized = false

  if (visibilityBound) {
    document.removeEventListener('visibilitychange', applyVisibility)
    visibilityBound = false
  }

  stopProbe()
  busyDepth = 0

  const el = root()
  if (el) {
    delete el.dataset[ATTR_BUSY]
    delete el.dataset[ATTR_LOW]
    delete el.dataset[ATTR_HIDDEN]
  }
}

/**
 * Agent 任务开始 — 进入动效收敛状态。
 *
 * 与 `exitAgentBusy` 成对出现，由 `IntelligenceCore.send` 在任务登记后调用。
 */
export function enterAgentBusy(): void {
  busyDepth += 1
  if (busyDepth > 1) return

  const el = root()
  if (el) el.dataset[ATTR_BUSY] = '1'
  if (typeof document !== 'undefined' && !document.hidden) startProbe()
}

/**
 * Agent 任务结束 — 撤销动效收敛状态。
 *
 * 必须放在 `finally` 路径：异常、用户中止、工具报错都会走到这里，漏掉任何一条
 * 都会把界面永久留在收敛状态（用户看到的是「动效再也不出现了」）。
 *
 * 掉帧降级标记（`perfLow`）在这一步刻意保留：它描述的是机器本身的渲染能力，
 * 与某一次任务无关。下一次执行会重新采样，帧率确实恢复时会自行撤销。
 */
export function exitAgentBusy(): void {
  if (busyDepth === 0) return
  busyDepth -= 1
  if (busyDepth > 0) return

  const el = root()
  if (el) delete el.dataset[ATTR_BUSY]

  stopProbe()
  lowStreak = 0
  goodStreak = 0
}

/** 当前是否处在动效收敛状态（排障用） */
export function getRenderBudgetState(): {
  busy: boolean
  busyDepth: number
  hidden: boolean
  perfLow: boolean
} {
  const el = root()
  return {
    busy: el?.dataset[ATTR_BUSY] === '1',
    busyDepth,
    hidden: el?.dataset[ATTR_HIDDEN] === '1',
    perfLow: el?.dataset[ATTR_LOW] === '1',
  }
}
