/**
 * 性能追踪上报器（渲染进程）
 *
 * 职责有三：
 * 1. 每秒上报 JS 堆占用与长任务统计，补齐主进程看不到的渲染侧视角
 * 2. 收集关键链路计数器（调用 / 短路 / 提交），用于判断有多少状态写入是白跑的
 * 3. 把代码里的关键时刻作为锚点钉到时间轴上，与主进程的进程占用同文件对齐
 *
 * ── 空闲时零开销 ──
 *
 * 所有上报入口都以 `enabled` 短路。未开启追踪时，bump/anchor 只是一次布尔判断，
 * 不构造对象、不触碰 IPC。埋点因此可以留在生产代码里长期存在，而不必在
 * 「埋点污染性能」和「出事时没有数据」之间做取舍。
 *
 * @module intelligence/diagnostics/perfTraceReporter
 */

import { logger } from '@toolkit/LogEngine'
import {
  PERF_TRACE_COUNTERS,
  type PerfTraceAnchorName,
  type PerfTraceRendererRecord,
} from '@shared/protocols/perfTraceProtocol'

/** 默认上报间隔（毫秒），与主进程采样间隔保持一致 */
const DEFAULT_INTERVAL_MS = 1000

/**
 * 单个上报窗口内允许发出的锚点上限。
 *
 * 主进程侧另有硬限流，但这里是第一道：一旦某个链路异常高频上报，
 * 与其把 IPC 打满再让主进程丢弃，不如在本地就截断，顺带留下丢弃计数。
 */
const MAX_ANCHORS_PER_WINDOW = 300

/** 锚点被本地截断时的计数器键名 */
const COUNTER_ANCHOR_DROPPED = 'anchor.dropped'

/** 主进程桥接的最小可用面（避免与类型声明文件强耦合） */
interface PerfTraceBridge {
  start?: (options?: { dir?: string; intervalMs?: number }) => Promise<{
    success?: boolean
    data?: { filePath?: string | null; running?: boolean }
    error?: string
  }>
  stop?: () => Promise<{
    success?: boolean
    data?: { filePath?: string | null; recordCount?: number }
    error?: string
  }>
  status?: () => Promise<{
    success?: boolean
    data?: {
      running?: boolean
      filePath?: string | null
      recordCount?: number
      droppedCount?: number
      lastError?: string
    }
    error?: string
  }>
  report?: (payload: unknown) => void
}

/** 是否已开启追踪 */
let enabled = false

/** 上报定时器 */
let flushTimer: ReturnType<typeof setInterval> | null = null

/** 当前上报窗口的采样间隔 */
let intervalMs = DEFAULT_INTERVAL_MS

/** 计数器（当前窗口的增量） */
let counters: Record<string, number> = {}

/** 当前窗口内已发出的锚点数 */
let windowAnchors = 0

/** 长任务累计（当前窗口） */
let longTaskCount = 0
let longTaskTotalMs = 0
let longTaskMaxMs = 0

/** 长任务按来源容器累计（当前窗口）：键为容器描述，值为次数、总耗时与单次峰值 */
let longTaskByContainer = new Map<string, { count: number; ms: number; maxMs: number }>()

/** 长任务观察器 */
let longTaskObserver: PerformanceObserver | null = null

/**
 * 当前帧窗口的起点（performance.now() 基准）。
 *
 * 由共享帧循环（streamFrameScheduler）在执行业务任务之前打点，提交探针再把
 * 「本子树提交结束」与它相减，得到「这一帧里我们自己的渲染与提交花了多久」。
 * 这样长任务的耗时就能被拆成两段：我们的 JS，以及浏览器的样式与绘制。
 * null 表示当前不在帧回调内 —— 组件在其它时机提交时不做记账，避免把
 * 与帧无关的提交算进帧成本。
 */
let frameWindowStart: number | null = null

/**
 * 长动画帧（LoAF）累计（当前窗口）。
 *
 * 与 longtask 并行采集：longtask 回答「主线程被占用了多久」，LoAF 回答
 * 「被谁占用」。不支持该 entry 类型的环境下这些值恒为 0，上报时整块省略。
 */
let loafFrames = 0
let loafBlockingMs = 0
let loafMaxBlockingMs = 0
let loafForcedStyleLayoutMs = 0
/** 「帧开始 → 渲染开始」累计：渲染管线接手前主线程被任务占用的时间 */
let loafTaskMs = 0
/** 「渲染开始 → 帧呈现」累计：样式计算、布局、绘制与合成 */
let loafRenderMs = 0
let loafMaxRenderMs = 0
/** renderStart 可用的帧数：分段统计只在 Chromium 给出该时间点时才有意义 */
let loafSegmentedFrames = 0

/** 长动画帧里的脚本耗时按来源聚合：键为「函数名 @ 文件名」 */
let loafByScript = new Map<string, { count: number; ms: number; maxMs: number; forcedMs: number }>()

/** 脚本来源聚合上限：来源可能是动态生成的匿名串，无上限会撑大记录体积 */
const MAX_LOAF_SCRIPT_KEYS = 40

/** 长动画帧观察器 */
let loafObserver: PerformanceObserver | null = null

/**
 * 内存读数失效状态。
 *
 * `performance.memory` 是唯一来源，而 Chromium 对这个 API 做了精度限制，
 * 实测读数会退化成常数：连续 380 个上传窗口的 usedMB 全部是同一个值，
 * 与此同时主进程侧能看到主窗口的工作集在 500~900MB 之间起伏。内存不可能
 * 连续三百秒一分不涨，因此连续多次完全一致的读数只能判定为 API 失效。
 */
let lastUsedMB = -1
let identicalMemoryReads = 0

/** 判定内存读数失效的连续相同次数 */
const MEMORY_STALE_LIMIT = 5

/**
 * LoAF 归因能力。
 *
 * scripts 与 renderStart 并非所有环境都提供：实测 505 帧中 502 帧的 scripts
 * 为空、没有一帧带 renderStart。这种情况下逐帧遍历 scripts、判断 renderStart
 * 只是白跑，探测到连续多帧无归因后停止采集这两项，只保留帧数与阻塞时长——
 * 后者仍是 LoAF 相对 longtask 的独有价值（帧时长扣掉阈值，更接近用户实际
 * 感到的迟滞）。
 */
let loafAttributionUsable = true
let loafFramesWithoutAttribution = 0

/** 判定 LoAF 归因不可用的连续无归因帧数 */
const LOAF_UNATTRIBUTED_LIMIT = 30

/** 来源容器缺省值：长任务发生在窗口自身的主文档上 */
const MAIN_DOCUMENT = 'main-document'

/**
 * 取长任务的来源容器描述。
 *
 * 同一个渲染进程里，主文档与挂在它下面的 iframe（预览、编辑器、终端回显）
 * 共用一个主线程，长任务都记在一个账上。attribution 里带着 containerType /
 * containerName，据此才能把「帧率卡顿」与「某段正文解析卡顿」分开——
 * 只看总耗时的话，一个持续重绘的子框架就能让整份结论指向错误的代码。
 */
function describeAttribution(entry: PerformanceEntry): string {
  const attribution = (entry as PerformanceEntry & {
    attribution?: Array<Record<string, unknown>>
  }).attribution

  const first = attribution?.[0]
  if (!first) return MAIN_DOCUMENT

  const type = typeof first.containerType === 'string' ? first.containerType : ''
  // 主文档自身的 attribution 里 containerType 为空或为 window
  if (!type || type === 'window') return MAIN_DOCUMENT

  const label = [first.containerName, first.containerId, first.containerSrc].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )

  return label ? `${type}:${label}` : type
}

/** 上报窗口标识：入口文件名 + 窗口名，用于区分多个渲染窗口的记录 */
function describeWindow(): string {
  const entry = window.location.pathname.split('/').filter(Boolean).pop() ?? 'index.html'
  return window.name ? `${entry}#${window.name}` : entry
}

// ============================================================
// 桥接访问
// ============================================================

function getBridge(): PerfTraceBridge | undefined {
  return (window as unknown as { electronAPI?: { perfTrace?: PerfTraceBridge } }).electronAPI?.perfTrace
}

// ============================================================
// 计数器
// ============================================================

/**
 * 计数器自增。
 *
 * 刻意不做存在性检查后再赋值这类花哨优化：调用点都在同步热路径上，
 * 一次对象属性读写远比提前构造 Map 便宜。
 */
export function bump(key: string, delta = 1): void {
  if (!enabled) return
  counters[key] = (counters[key] ?? 0) + delta
}

/** 取出当前窗口的计数器增量并归零 */
function takeCounters(): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const key of Object.keys(counters)) {
    snapshot[key] = counters[key]
  }
  counters = {}
  windowAnchors = 0
  return snapshot
}

// ============================================================
// 帧窗口
// ============================================================

/**
 * 标记帧回调开始。
 *
 * 由共享帧循环调用，是「帧内成本」记账的唯一入口：任务的执行耗时、任务的
 * 微任务排空耗时、以及提交探针测到的子树提交耗时，全部相对这个时刻计算。
 */
export function beginFrameWindow(start: number): void {
  if (!enabled) return
  frameWindowStart = start
}

/** 当前帧窗口起点；不在帧回调内时返回 null */
export function currentFrameWindowStart(): number | null {
  return frameWindowStart
}

/**
 * 收尾本次帧窗口。
 *
 * 收尾动作刻意排在微任务而不是同步执行：React 由 state 写入触发的提交通常
 * 落在同一次任务中紧随其后的微任务里，同步收尾会量不到这段提交。因此这里
 * 在任务末尾排一个微任务，等提交链跑完再结算。
 *
 * 若 React 把提交推迟到了下一个宏任务（低优先级更新），这段耗时不会被计入
 * commitMs —— 读数会偏小。判读时配合 commitMs 与 taskMs 的比值看：两者接近
 * 说明没有额外提交，明显偏大说明提交确实落在本次任务里。
 */
export function endFrameWindow(): void {
  if (!enabled || frameWindowStart === null) return

  queueMicrotask(() => {
    const start = frameWindowStart
    frameWindowStart = null
    if (start === null) return

    bump(PERF_TRACE_COUNTERS.frameCommitMs, performance.now() - start)
  })
}

// ============================================================
// 锚点
// ============================================================

/**
 * 打一个事件锚点。
 *
 * detail 里的字段应当保持扁平且体积小：整条记录会被序列化写入 JSONL，
 * 顺手塞进一个大对象会让文件迅速膨胀，也会拖慢上报本身。
 */
export function anchor(
  name: PerfTraceAnchorName,
  edge: 'begin' | 'end',
  detail?: Record<string, unknown>,
): void {
  if (!enabled) return

  if (windowAnchors >= MAX_ANCHORS_PER_WINDOW) {
    counters[COUNTER_ANCHOR_DROPPED] = (counters[COUNTER_ANCHOR_DROPPED] ?? 0) + 1
    return
  }
  windowAnchors++

  const bridge = getBridge()
  if (!bridge?.report) return

  bridge.report({ type: 'anchor', t: Date.now(), name, edge, detail })
}

// ============================================================
// 采样
// ============================================================

/**
 * 读取 JS 堆占用（MB）。
 *
 * 来源不可靠时返回 undefined，让字段整块缺席。宁可留空也不上报一条恒定的
 * 假曲线：常数序列看起来像「内存没涨」，与真实的几百 MB 起伏是完全相反的
 * 结论。判断内存走势请用 tick 里进程级的 wsMB。
 */
function sampleMemory(): PerfTraceRendererRecord['mem'] {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
  }).memory

  if (!memory) return undefined

  const usedMB = toMB(memory.usedJSHeapSize)

  if (usedMB === lastUsedMB) {
    identicalMemoryReads++
    if (identicalMemoryReads >= MEMORY_STALE_LIMIT) return undefined
  } else {
    identicalMemoryReads = 0
  }
  lastUsedMB = usedMB

  return {
    usedMB,
    totalMB: toMB(memory.totalJSHeapSize),
    limitMB: toMB(memory.jsHeapSizeLimit),
  }
}

/**
 * 装上长任务观察器。
 *
 * 长任务（>50ms）是「界面发卡」的直接证据：连续的长任务说明主线程被
 * 同步计算占住，而 CPU 曲线本身无法区分「忙于计算」和「忙于唤醒调度」。
 */
function ensureLongTaskObserver(): void {
  if (longTaskObserver) return
  if (typeof PerformanceObserver === 'undefined') return

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount++
        longTaskTotalMs += entry.duration
        if (entry.duration > longTaskMaxMs) longTaskMaxMs = entry.duration

        const container = describeAttribution(entry)
        const bucket = longTaskByContainer.get(container) ?? { count: 0, ms: 0, maxMs: 0 }
        bucket.count++
        bucket.ms += entry.duration
        if (entry.duration > bucket.maxMs) bucket.maxMs = entry.duration
        longTaskByContainer.set(container, bucket)
      }
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch (err) {
    // 部分运行环境不支持 longtask 条目类型，静默降级：其余采样仍然可用
    longTaskObserver = null
    logger.system.warn('[PerfTrace] longtask 观察器不可用:', err)
  }
}

/** 停止观察长任务 */
function disposeLongTaskObserver(): void {
  if (!longTaskObserver) return
  try {
    longTaskObserver.disconnect()
  } catch {
    // 忽略：销毁阶段的异常不影响收尾
  }
  longTaskObserver = null
}

/* ------------------------------------------------------------------ */
/* 长动画帧（LoAF）                                                    */
/* ------------------------------------------------------------------ */

/** LoAF 条目里的单个脚本片段（Chromium 扩展，标准类型里没有） */
interface LoafScriptTiming {
  invoker?: string
  invokerType?: string
  sourceURL?: string
  sourceFunctionName?: string
  duration?: number
  forcedStyleAndLayoutDuration?: number
}

/** LoAF 条目（Chromium 扩展） */
interface LoafEntry extends PerformanceEntry {
  blockingDuration?: number
  scripts?: LoafScriptTiming[]
  /** 渲染（样式/布局）开始时刻，同源于 performance.now() */
  renderStart?: number
  /** 强制同步样式/布局开始时刻 */
  styleAndLayoutStart?: number
}

/** 从 URL 里取文件名：完整路径写进 JSONL 会让记录迅速膨胀 */
function describeScriptOrigin(url: string): string {
  const clean = url.split(/[?#]/)[0]
  const parts = clean.split('/')
  return parts[parts.length - 1] || clean
}

/**
 * 脚本片段的来源描述。
 *
 * 函数名比文件名有用得多：同一个 bundle 里既有渲染循环也有布局读取，
 * 只记文件名等于没记。函数名缺失（匿名回调）时退化到调用者类型。
 */
function describeScript(script: LoafScriptTiming): string {
  const origin = script.sourceURL ? describeScriptOrigin(script.sourceURL) : ''
  const fn = script.sourceFunctionName
  if (fn && origin) return `${fn} @ ${origin}`
  if (fn) return fn
  if (origin) return origin
  return script.invokerType ?? script.invoker ?? 'unknown'
}

/** 累计一帧长动画帧的归因数据 */
function accumulateLoaf(entry: LoafEntry): void {
  loafFrames++

  const blocking = entry.blockingDuration ?? 0
  loafBlockingMs += blocking
  if (blocking > loafMaxBlockingMs) loafMaxBlockingMs = blocking

  // 归因能力探测：连续多帧都拿不到脚本与渲染起点，就认定环境不提供这两项
  if (loafAttributionUsable) {
    const hasAttribution = (entry.scripts?.length ?? 0) > 0 || (entry.renderStart ?? 0) > 0
    if (hasAttribution) {
      loafFramesWithoutAttribution = 0
    } else if (++loafFramesWithoutAttribution >= LOAF_UNATTRIBUTED_LIMIT) {
      loafAttributionUsable = false
      logger.system.info('[PerfTrace] 当前环境不提供 LoAF 脚本归因，已降级为仅统计帧数与阻塞时长')
    }
  }

  if (!loafAttributionUsable) return

  // 帧内两段耗时：脚本侧与渲染侧。只有 Chromium 给出 renderStart 时才可切分，
  // 缺失时整帧不计入分段（宁可留空，也不用错误的切分误导结论）。
  const renderStart = entry.renderStart ?? 0
  if (renderStart > 0) {
    const taskMs = Math.max(0, renderStart - entry.startTime)
    const renderMs = Math.max(0, entry.startTime + entry.duration - renderStart)
    loafTaskMs += taskMs
    loafRenderMs += renderMs
    if (renderMs > loafMaxRenderMs) loafMaxRenderMs = renderMs
    loafSegmentedFrames++
  }

  for (const script of entry.scripts ?? []) {
    const duration = script.duration ?? 0
    const forced = script.forcedStyleAndLayoutDuration ?? 0
    loafForcedStyleLayoutMs += forced

    const key = describeScript(script)
    let bucket = loafByScript.get(key)
    if (!bucket) {
      // 超出上限的来源不再新建键，只把耗时计入总量，避免长尾撑大记录
      if (loafByScript.size >= MAX_LOAF_SCRIPT_KEYS) continue
      bucket = { count: 0, ms: 0, maxMs: 0, forcedMs: 0 }
      loafByScript.set(key, bucket)
    }
    bucket.count++
    bucket.ms += duration
    bucket.forcedMs += forced
    if (duration > bucket.maxMs) bucket.maxMs = duration
  }
}
/** 装上长动画帧观察器：不支持的环境静默跳过，其余采样不受影响 */
function ensureLoafObserver(): void {
  if (loafObserver) return
  if (typeof PerformanceObserver === 'undefined') return

  const supported = PerformanceObserver.supportedEntryTypes
  if (!Array.isArray(supported) || !supported.includes('long-animation-frame')) return

  try {
    loafObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        accumulateLoaf(entry as LoafEntry)
      }
    })
    loafObserver.observe({ entryTypes: ['long-animation-frame'] })
  } catch (err) {
    loafObserver = null
    logger.system.warn('[PerfTrace] long-animation-frame 观察器不可用:', err)
  }
}

/** 停止观察长动画帧 */
function disposeLoafObserver(): void {
  if (!loafObserver) return
  try {
    loafObserver.disconnect()
  } catch {
    // 忽略：销毁阶段的异常不影响收尾
  }
  loafObserver = null
}

/** 归零长动画帧统计 */
function resetLoafStats(): void {
  loafFrames = 0
  loafBlockingMs = 0
  loafMaxBlockingMs = 0
  loafForcedStyleLayoutMs = 0
  loafTaskMs = 0
  loafRenderMs = 0
  loafMaxRenderMs = 0
  loafSegmentedFrames = 0
  loafByScript = new Map()
}

/** 取出当前窗口的长动画帧统计并归零；本窗口没有长动画帧时整块省略 */
function takeLoaf(): PerfTraceRendererRecord['loaf'] {
  if (loafFrames === 0) {
    resetLoafStats()
    return undefined
  }

  const byScript = [...loafByScript.entries()]
    .map(([name, bucket]) => ({
      name,
      count: bucket.count,
      totalMs: round2(bucket.ms),
      maxMs: round2(bucket.maxMs),
      forcedStyleAndLayoutMs: round2(bucket.forcedMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5)

  const result: PerfTraceRendererRecord['loaf'] = {
    frames: loafFrames,
    blockingMs: round2(loafBlockingMs),
    maxBlockingMs: round2(loafMaxBlockingMs),
    // 没有任何一帧带 renderStart 时整段省略：属性缺失比「全是 0」更能表达
    // 「这个环境不支持分段」，避免事后把 0 误读成「渲染不耗时」
    ...(loafSegmentedFrames > 0
      ? {
          taskMs: round2(loafTaskMs),
          renderMs: round2(loafRenderMs),
          maxRenderMs: round2(loafMaxRenderMs),
        }
      : {}),
    forcedStyleAndLayoutMs: round2(loafForcedStyleLayoutMs),
    byScript,
  }

  resetLoafStats()
  return result
}

/** 取出当前窗口的长任务统计并归零 */
function takeLongTasks(): PerfTraceRendererRecord['longTasks'] {
  // 按耗时降序只留前几项：容器数量有限，但截断能让记录体积与实际排查需求匹配
  const byContainer = [...longTaskByContainer.entries()]
    .map(([name, bucket]) => ({
      name,
      count: bucket.count,
      totalMs: round2(bucket.ms),
      maxMs: round2(bucket.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5)

  const result: PerfTraceRendererRecord['longTasks'] = {
    count: longTaskCount,
    totalMs: round2(longTaskTotalMs),
    maxMs: round2(longTaskMaxMs),
  }
  if (byContainer.length > 0) result.byContainer = byContainer

  longTaskCount = 0
  longTaskTotalMs = 0
  longTaskMaxMs = 0
  longTaskByContainer = new Map()
  return result
}

/** 执行一次上报 */
function flush(): void {
  if (!enabled) return

  const bridge = getBridge()
  if (!bridge?.report) return

  const payload: PerfTraceRendererRecord = {
    type: 'renderer',
    t: Date.now(),
    window: describeWindow(),
    counters: takeCounters(),
    longTasks: takeLongTasks(),
  }

  const mem = sampleMemory()
  if (mem) payload.mem = mem

  const loaf = takeLoaf()
  if (loaf) payload.loaf = loaf

  bridge.report(payload)
}

// ============================================================
// 生命周期
// ============================================================

/** 开始追踪（主进程采集 + 渲染层上报同时启动） */
export async function start(options?: { dir?: string; intervalMs?: number }): Promise<{
  ok: boolean
  filePath?: string
  error?: string
}> {
  const bridge = getBridge()
  if (!bridge?.start) {
    return { ok: false, error: '性能追踪桥接不可用（preload 未暴露 perfTrace）' }
  }

  const nextInterval = options?.intervalMs && options.intervalMs >= 200
    ? Math.floor(options.intervalMs)
    : DEFAULT_INTERVAL_MS

  const response = await bridge.start({ dir: options?.dir, intervalMs: nextInterval })
  if (!response?.success) {
    return { ok: false, error: response?.error ?? '主进程启动追踪失败' }
  }

  // 主进程已就绪才打开本地开关：否则会出现「本地在发、主进程在丢」的空转
  enableLocalReporting(nextInterval)

  const filePath = response.data?.filePath ?? undefined
  logger.system.info(`[PerfTrace] 渲染层上报已启动 → ${filePath ?? '(路径未知)'}`)

  return { ok: true, filePath }
}

/** 停止追踪 */
export async function stop(): Promise<{ ok: boolean; error?: string }> {
  // 先关本地开关，避免停止过程中还有新的上报排队
  stopLocal()

  const bridge = getBridge()
  if (!bridge?.stop) return { ok: true }

  const response = await bridge.stop()
  if (!response?.success) {
    return { ok: false, error: response?.error ?? '主进程停止追踪失败' }
  }

  logger.system.info(`[PerfTrace] 渲染层上报已停止`)
  return { ok: true }
}

/**
 * 只打开本地上报，不触碰主进程。
 *
 * 供主进程广播的自动挂载使用：那一侧已经在采样，这里再调一次 start 会让主
 * 进程停掉当前会话重开一个，并再广播一轮信号，自激成环。
 */
export function startLocal(nextInterval?: number): void {
  if (enabled) return

  enableLocalReporting(nextInterval)
  logger.system.info('[PerfTrace] 收到主进程信号，已跟随开启本地上报')
}

/** 只关闭本地上报，不触碰主进程。与 startLocal 对称。 */
export function stopLocal(): void {
  if (!enabled && !flushTimer) return

  enabled = false

  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }

  resetLongTaskStats()
  disposeLongTaskObserver()
  disposeLoafObserver()
}

/**
 * 打开本地上报开关并装上观察器。
 *
 * 主动开启（start）与跟随广播（startLocal）共用这一段：两条路径的本地动作
 * 完全一致，差别只在于要不要通知主进程。
 */
function enableLocalReporting(nextInterval?: number): void {
  intervalMs = nextInterval && nextInterval >= 200
    ? Math.floor(nextInterval)
    : DEFAULT_INTERVAL_MS

  enabled = true
  counters = {}
  windowAnchors = 0
  resetLongTaskStats()

  ensureLongTaskObserver()
  ensureLoafObserver()

  if (flushTimer) clearInterval(flushTimer)
  flushTimer = setInterval(flush, intervalMs)
}

/** 查询状态（合并主进程状态与本地开关） */
export async function status(): Promise<{
  running: boolean
  localReporting: boolean
  filePath: string | null
  recordCount: number
  droppedCount: number
  lastError: string
}> {
  const bridge = getBridge()
  const response = await bridge?.status?.()
  const data = response?.data

  return {
    running: data?.running ?? false,
    localReporting: enabled,
    filePath: data?.filePath ?? null,
    recordCount: data?.recordCount ?? 0,
    droppedCount: data?.droppedCount ?? 0,
    lastError: data?.lastError ?? response?.error ?? '',
  }
}

/** 当前是否在追踪 */
export function isEnabled(): boolean {
  return enabled
}

/** 读取计数器当前值（不清零），供人工排查时快速确认埋点是否生效 */
export function peekCounters(): Record<string, number> {
  return { ...counters }
}

function resetLongTaskStats(): void {
  longTaskCount = 0
  longTaskTotalMs = 0
  longTaskMaxMs = 0
  longTaskByContainer = new Map()
  // 帧窗口是「当前正在执行」的状态，跨会话残留会让停止后第一次提交
  // 量到一个巨大的差值
  frameWindowStart = null
  resetLoafStats()
}

/** 保留两位小数 */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/** 字节转 MB */
function toMB(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

// ============================================================
// 初始化
// ============================================================

/**
 * 挂载全局快捷入口。
 *
 * 排查现场通常已经开着 DevTools，控制台一行 `__perfTrace.start()` 比
 * 翻设置页快得多，因此把入口直接挂到 window 上。这里不做自动启动：
 * 常驻采集对绝大多数会话都是无谓开销。
 */
export function initPerfTraceReporter(): void {
  const target = window as unknown as { __perfTrace?: Record<string, unknown> }

  target.__perfTrace = {
    start,
    stop,
    status,
    anchor,
    bump,
    isEnabled,
    /** 计数器快照，用于确认埋点是否真的被触发 */
    counters: peekCounters,
    /** 计数器的键名清单，避免使用时靠猜 */
    counterKeys: PERF_TRACE_COUNTERS,
  }

  logger.system.info('[PerfTrace] 已挂载 window.__perfTrace，控制台可执行 __perfTrace.start()')
}

/** 计数器键名再导出，供埋点处引用而不必重复拼字符串 */
export { PERF_TRACE_COUNTERS }
