/**
 * 流式渲染帧调度器
 *
 * ── 要解决的问题 ──
 *
 * 流式期间有三处互不相干的时间源：流式缓冲刷写（80ms）、平滑插值推进（66ms）、
 * 吸底轮询（300ms）。相位不对齐时，同一份新内容会在相邻的几个任务里各自写一次
 * store、各自推一次 state。Zustand 的写入会立刻通知 useSyncExternalStore 的订阅者，
 * React 于是把它们算成多次提交 —— 一秒里叠出十几次提交，而用户看到的只是同一段
 * 文字在动。继续微调各自的间隔解决不了这个问题：只要时间源是三个，相位就一定会漂。
 *
 * ── 做法 ──
 *
 * 把「什么时候写」收敛到同一个动画帧循环：所有已到期的任务在同一个
 * requestAnimationFrame 回调里顺序执行，React 会把它们批成一次提交，且写入落在
 * 绘制之前，避免同一帧内先读后写造成的强制同步布局。
 *
 * 调度语义是「一次性 + 合并」：只保证任务会在 delayMs 之后的某个动画帧里执行一次，
 * 同一个任务重复登记取最早的那次。需要周期执行的任务在自身末尾重新登记即可
 * （流式插值与吸底轮询都是这个模式），因此空闲时调度器里没有任何定时器与帧回调，
 * 不引入额外的空闲唤醒。
 *
 * @module intelligence/state/streamFrameScheduler
 */

import { logger } from '@toolkit/LogEngine'
import * as perfTrace from '../diagnostics/perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

/** 帧任务的类型：无参、无返回值、同步执行 */
export type FrameTask = () => void

/** 页面隐藏时的唤醒间隔（毫秒）：退化为定时器轮询 */
const HIDDEN_WAKE_INTERVAL_MS = 16

/** 待执行任务 → 最早可执行时刻（performance.now() 基准） */
const pending = new Map<FrameTask, number>()

/** 已排入的动画帧回调 id */
let frameId: number | null = null

/** 已排入的定时器唤醒 id */
let wakeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 已排入唤醒的计划时刻（performance.now() 基准）。
 *
 * 只用于判断「新请求需不需要把唤醒提前」：比已排的更晚就保持不变，
 * 避免同一帧内反复取消重排。null 表示当前没有排入任何唤醒。
 */
let wakeAt: number | null = null

/** 页面是否不可见 */
function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** 清掉已排入的唤醒（动画帧与定时器只会有一个生效） */
function clearWakeup(): void {
  if (frameId !== null) {
    cancelAnimationFrame(frameId)
    frameId = null
  }
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
  wakeAt = null
}

/**
 * 排入一次唤醒
 *
 * 已有的唤醒若不晚于本次请求就原样保留。这条判断不是优化而是必要：同一帧里
 * 每个任务登记时都会走一次本函数，若无条件取消重排，一次提交内就会反复
 * cancelAnimationFrame + requestAnimationFrame，把「合并」变成「互相顶替」。
 *
 * 页面隐藏时 requestAnimationFrame 不会触发（窗口最小化、系统挂起），此时退化为
 * 定时器：否则后台流式内容就一直停在缓冲里，直到窗口恢复才一次性涌出，内存峰与
 * 观感都比现在更差。
 */
function wakeAfter(delayMs: number): void {
  const hidden = isPageHidden()

  // 隐藏时下限取一个帧长：任务以 0 延迟续期时，否则会退化成紧凑的
  // setTimeout(0) 轮询，反而比动画帧更费电
  const delay = hidden ? Math.max(HIDDEN_WAKE_INTERVAL_MS, delayMs) : Math.max(0, delayMs)
  const target = performance.now() + delay

  if (wakeAt !== null && wakeAt <= target) return

  clearWakeup()
  wakeAt = target

  if (delay <= 0) {
    frameId = requestAnimationFrame(runFrame)
    return
  }

  wakeTimer = setTimeout(() => {
    wakeTimer = null
    wakeAt = null
    if (isPageHidden()) {
      runFrame()
      return
    }
    frameId = requestAnimationFrame(runFrame)
  }, delay)
}

/** 按最早到期时间重新排入唤醒；没有待执行任务时不留任何定时器 */
function arm(): void {
  const now = performance.now()
  let earliest = Infinity
  for (const dueAt of pending.values()) {
    if (dueAt < earliest) earliest = dueAt
  }

  if (earliest === Infinity) {
    clearWakeup()
    return
  }

  wakeAfter(earliest - now)
}

/** 执行本帧所有到期任务 */
function runFrame(): void {
  frameId = null
  // 唤醒已经兑现，计划时刻随之作废；否则后续 arm() 会误判「已有更早的唤醒」
  wakeAt = null

  const frameStart = performance.now()

  // 打开帧窗口：下面任务的执行耗时、以及 React 随后落地的提交，都由这个
  // 时刻起算。长任务只说明主线程被占了多久，这三项才能说明占在哪一环。
  perfTrace.beginFrameWindow(frameStart)

  const now = frameStart
  const due: FrameTask[] = []
  for (const [task, dueAt] of pending) {
    if (dueAt <= now) due.push(task)
  }

  if (due.length > 0) {
    for (const task of due) pending.delete(task)

    perfTrace.bump(PERF_TRACE_COUNTERS.frameRuns)
    perfTrace.bump(PERF_TRACE_COUNTERS.frameTasks, due.length)

    // 同一帧内顺序执行。执行先后不作为语义依赖：两次写入落在同一个任务里，
    // React 18 的自动批处理会把它们并成一次提交，谁先谁后都只提交一次。
    for (const task of due) {
      try {
        task()
      } catch (error) {
        // 单个任务抛错不应拖垮同一帧里的其他任务，否则一次异常就会让流式
        // 渲染整体停摆，且现场只留下「内容不动」这一个现象。
        logger.system.warn('[StreamFrame] 帧任务执行失败:', error)
      }
    }

    // 只记我们自己的任务代码：这一项与 commitMs 的差值就是 React 的渲染与提交
    perfTrace.bump(PERF_TRACE_COUNTERS.frameTaskMs, performance.now() - frameStart)
  }

  // 结算帧窗口（内部排在微任务里，等 React 提交链跑完）
  perfTrace.endFrameWindow()

  arm()
}

/**
 * 登记一个帧任务
 *
 * @param task 任务本体。必须保持函数引用稳定（例如在 effect 里创建一次），
 *             因为它同时充当去重键：每次新建函数都会被当成一个不同的任务。
 * @param delayMs 最早延迟，任务不会早于这个时间执行；默认下一帧
 */
export function scheduleFrameTask(task: FrameTask, delayMs = 0): void {
  const dueAt = performance.now() + (delayMs > 0 ? delayMs : 0)
  const scheduled = pending.get(task)

  // 已有更早的登记：保留它，避免周期任务被自己的重复登记推迟
  if (scheduled !== undefined && scheduled <= dueAt) return

  pending.set(task, dueAt)
  arm()
}

/** 取消一个帧任务。已执行的任务取消是空操作 */
export function cancelFrameTask(task: FrameTask): void {
  if (!pending.delete(task)) return
  // 取消后可能已经没有待执行任务，需要回收已排入的唤醒
  if (pending.size === 0) clearWakeup()
}
