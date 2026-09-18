import { useState, useEffect, useRef } from 'react'
import type { ScenarioDomain } from '@configuration/defaultProfile'
import * as perfTrace from '@intelligence/diagnostics/perfTraceReporter'
import { scheduleFrameTask, cancelFrameTask } from '@intelligence/state/streamFrameScheduler'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

/** 流式期间每帧推进间隔（毫秒） */
const STREAM_TICK_MS = 66

/** 收尾动画每帧推进间隔（毫秒） */
const CATCH_UP_TICK_MS = 50

/** 间距小于等于此值时一次性补齐，避免逐字符抖动 */
const DIRECT_FINISH_GAP = 3

/**
 * 流式基础推进速率（字符/秒）
 *
 * 观感取决于「单位时间推进量是否恒定」，而不是推进比例。
 * 比例推进时步长随积压量放大 —— 积压 200 字符一帧跳 30 个，积压 20 字符一帧走 3 个，
 * 上一批与下一批之间的间隔又被上游到达节奏带动，观感就是一段一段地跳。
 * 改成固定速率后，积压无论多少，单位时间推进量都落在可控区间内，才是连续的流式效果。
 */
const BASE_CHARS_PER_SECOND = 40

/** 收尾阶段基础速率（字符/秒），略快于流式以减少等待 */
const CATCH_UP_CHARS_PER_SECOND = 120

/** 积压每增加这么多字符，推进速率提升一档 */
const BACKLOG_TIER_CHARS = 150

/** 每档提升的速率（字符/秒） */
const BACKLOG_CHARS_PER_SECOND = 30

/** 流式阶段速率上限：避免积压过大时一帧跳出整段文本 */
const MAX_CHARS_PER_SECOND = 300

/** 收尾阶段速率上限 */
const CATCH_UP_MAX_CHARS_PER_SECOND = 600

/**
 * 收尾阶段的目标补齐时长（毫秒）
 *
 * 输出结束后用户已在等待结果，剩余文本需要有一个可预期的补齐时间，
 * 不能按基础速率慢慢推进。这里按预算反推每帧最小推进量，
 * 再与单帧上限取小，兼顾补齐速度与画面连续性。
 */
const CATCH_UP_BUDGET_MS = 600

/** 收尾阶段单帧推进上限：上限越高补齐越快，一次跳出的文本越多 */
const CATCH_UP_MAX_STEP_CHARS = 36

/**
 * 按积压量解算推进速率（字符/秒）
 *
 * 基础速率保证连续的流式观感；积压超过一个档位后线性提速，避免上游输出速度
 * 长期高于渲染速度导致内容越积越多、最终在结束时整段涌出。
 */
function resolveCharsPerSecond(
  gap: number,
  baseRate: number,
  maxRate: number,
): number {
  const backlogTiers = Math.floor(gap / BACKLOG_TIER_CHARS)
  return Math.min(maxRate, baseRate + backlogTiers * BACKLOG_CHARS_PER_SECOND)
}

/**
 * 按内容规模解析推进间隔
 *
 * 每次推进都会重写尾部文本节点，文本越长，浏览器的文本布局代价越高。
 * 因此按规模适度放宽间隔；速率随间隔同步换算，推进观感不随间隔变化。
 */
function resolveTickMs(baseTickMs: number, contentLength: number): number {
  if (contentLength > 60_000) return baseTickMs * 2
  if (contentLength > 20_000) return Math.round(baseTickMs * 1.5)
  return baseTickMs
}

/** 推进显示长度并返回新内容切片 */
function advance(
  content: string,
  currentLen: number,
  baseRate: number,
  maxRate: number,
  tickMs: number,
  directGap: number = DIRECT_FINISH_GAP,
): { nextLen: number; slice: string } | null {
  const target = content.length
  if (currentLen >= target) return null

  const gap = target - currentLen
  // 收尾缝隙直接补齐，复用原字符串引用，避免生成等长副本
  if (gap <= directGap) return { nextLen: target, slice: content }

  const rate = resolveCharsPerSecond(gap, baseRate, maxRate)
  const step = Math.max(1, Math.round((rate * tickMs) / 1000))
  const nextLen = Math.min(target, currentLen + step)
  return { nextLen, slice: content.slice(0, nextLen) }
}

/**
 * 收尾阶段的推进
 *
 * 与流式阶段的差异：这里有一个明确的补齐预算，剩余文本要在预算内显示完，
 * 否则「内容已经生成完、画面还在慢慢出字」的观感比一次补齐更糟。
 * 因此取「速率推进量」与「预算反推量」的较大者，再受单帧上限约束。
 */
function advanceCatchUp(
  content: string,
  currentLen: number,
  rateScale: number,
  tickMs: number,
  directGap: number,
): { nextLen: number; slice: string } | null {
  const target = content.length
  if (currentLen >= target) return null

  const gap = target - currentLen
  if (gap <= directGap) return { nextLen: target, slice: content }

  const rate = resolveCharsPerSecond(
    gap,
    CATCH_UP_CHARS_PER_SECOND * rateScale,
    CATCH_UP_MAX_CHARS_PER_SECOND * rateScale,
  )
  const rateStep = Math.round((rate * tickMs) / 1000)
  const budgetSteps = Math.max(1, Math.round(CATCH_UP_BUDGET_MS / tickMs))
  const budgetStep = Math.ceil(gap / budgetSteps)

  const step = Math.min(gap, CATCH_UP_MAX_STEP_CHARS, Math.max(1, rateStep, budgetStep))
  const nextLen = currentLen + step
  return { nextLen, slice: content.slice(0, nextLen) }
}

/**
 * 平滑流式文本插值器
 *
 * 在流式输出期间按固定速率推进显示长度，收尾时以更高速率补齐剩余内容，
 * 避免内容突变造成的视觉跳动。
 */
export function useSmoothStream(
  content: string,
  isStreaming: boolean,
  speedMultiplier = 1,
): { displayedContent: string } {
  const [displayedContent, setDisplayedContent] = useState(() =>
    isStreaming ? '' : content,
  )
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 清理收尾动画定时器 */
  const clearCatchUp = () => {
    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }
  }

  // 同步内容引用，并处理内容回退或收尾动画
  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (isStreaming) return

    if (displayedLenRef.current < content.length && catchUpTimerRef.current === null) {
      const runCatchUp = () => {
        const tickMs = resolveTickMs(CATCH_UP_TICK_MS, contentRef.current.length)
        const advanced = advanceCatchUp(
          contentRef.current,
          displayedLenRef.current,
          speedMultiplier,
          tickMs,
          DIRECT_FINISH_GAP,
        )
        if (!advanced) {
          catchUpTimerRef.current = null
          return
        }
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
        catchUpTimerRef.current = setTimeout(runCatchUp, tickMs)
      }
      catchUpTimerRef.current = setTimeout(
        runCatchUp,
        resolveTickMs(CATCH_UP_TICK_MS, contentRef.current.length),
      )
    } else if (displayedLenRef.current >= content.length) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming, speedMultiplier])

  // 流式期间推进循环
  useEffect(() => {
    if (!isStreaming) return

    clearCatchUp()

    const runStream = () => {
      const tickMs = resolveTickMs(STREAM_TICK_MS, contentRef.current.length)
      const advanced = advance(
        contentRef.current,
        displayedLenRef.current,
        BASE_CHARS_PER_SECOND * speedMultiplier,
        MAX_CHARS_PER_SECOND * speedMultiplier,
        tickMs,
      )
      if (advanced) {
        // 计一帧：把「数据到达频率」与「渲染帧率」分开看，才能判断卡顿来自
        // 数据过密，还是插值器自己推得太快
        perfTrace.bump(PERF_TRACE_COUNTERS.smoothTicks)
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
      }
      // 末尾续期：任务在自身结束后重新登记，空闲时调度器里不留任何回调
      scheduleFrameTask(runStream, tickMs)
    }
    // 与流式缓冲刷写共用同一个帧循环：同一帧内的 store 写入与 state 推进
    // 会被 React 合并成一次提交，而不是相邻任务各提交一次
    scheduleFrameTask(runStream, resolveTickMs(STREAM_TICK_MS, contentRef.current.length))

    return () => cancelFrameTask(runStream)
  }, [isStreaming, speedMultiplier])

  // 卸载时清理收尾动画定时器（流式推进任务由上面的 effect 自行取消）
  useEffect(() => () => clearCatchUp(), [])

  return { displayedContent }
}


/* ------------------------------------------------------------------ */
/* 场景感知流式渲染策略                                               */
/* ------------------------------------------------------------------ */

/** 场景流式渲染策略 */
export interface ScenarioStreamRenderPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 流式每帧推进间隔（毫秒） */
  streamTickMs: number
  /** 收尾每帧推进间隔（毫秒） */
  catchUpTickMs: number
  /** 流式速率倍率（1 为标准速率） */
  streamFactor: number
  /** 收尾速率倍率 */
  catchUpFactor: number
  /** 是否启用平滑动画（医疗场景可能禁用以确保完整显示） */
  enableSmoothAnimation: boolean
  /** 直接补齐的字符间距阈值 */
  directFinishGap: number
}

/** 场景流式渲染策略预设 */
const SCENARIO_STREAM_RENDER_POLICIES: Record<ScenarioDomain, ScenarioStreamRenderPolicy> = {
  /** 法律场景：标准速度，确保可读性 */
  legal: {
    domain: 'legal',
    streamTickMs: 66,
    catchUpTickMs: 50,
    streamFactor: 1.0,
    catchUpFactor: 1.0,
    enableSmoothAnimation: true,
    directFinishGap: 3,
  },

  /** 医疗场景：禁用平滑动画，直接显示完整内容（合规要求） */
  medical: {
    domain: 'medical',
    streamTickMs: 0,
    catchUpTickMs: 0,
    streamFactor: 1.0,
    catchUpFactor: 1.0,
    enableSmoothAnimation: false,
    directFinishGap: Number.MAX_SAFE_INTEGER,
  },

  /** 教育场景：快速流畅，提升交互体验 */
  education: {
    domain: 'education',
    streamTickMs: 33,
    catchUpTickMs: 25,
    streamFactor: 1.6,
    catchUpFactor: 1.4,
    enableSmoothAnimation: true,
    directFinishGap: 5,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    streamTickMs: 66,
    catchUpTickMs: 50,
    streamFactor: 1.0,
    catchUpFactor: 1.0,
    enableSmoothAnimation: true,
    directFinishGap: 3,
  },
}

/**
 * 获取场景流式渲染策略
 */
export function getScenarioStreamRenderPolicy(
  domain: ScenarioDomain,
): ScenarioStreamRenderPolicy {
  return SCENARIO_STREAM_RENDER_POLICIES[domain]
}

/**
 * 场景感知的平滑流式文本插值器
 *
 * 根据场景类型调整渲染策略：
 * - 法律场景：标准平滑动画，确保可读性
 * - 医疗场景：禁用平滑动画，直接显示完整内容（合规要求）
 * - 教育场景：快速流畅，提升交互体验
 * - 通用场景：默认平滑动画
 */
export function useScenarioSmoothStream(
  content: string,
  isStreaming: boolean,
  domain: ScenarioDomain = 'general',
  speedMultiplier = 1,
): { displayedContent: string; policy: ScenarioStreamRenderPolicy } {
  const policy = SCENARIO_STREAM_RENDER_POLICIES[domain]

  // 医疗场景：禁用平滑动画，直接返回完整内容
  if (!policy.enableSmoothAnimation) {
    return { displayedContent: content, policy }
  }

  // 使用标准平滑流式，但应用场景特定的参数
  const { displayedContent } = useSmoothStreamImpl(
    content,
    isStreaming,
    speedMultiplier,
    policy,
  )

  return { displayedContent, policy }
}

/**
 * 内部实现：支持自定义策略的平滑流式
 */
function useSmoothStreamImpl(
  content: string,
  isStreaming: boolean,
  speedMultiplier: number,
  policy: ScenarioStreamRenderPolicy,
): { displayedContent: string } {
  const [displayedContent, setDisplayedContent] = useState(() =>
    isStreaming ? '' : content,
  )
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCatchUp = () => {
    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }
  }

  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (isStreaming) return

    if (displayedLenRef.current < content.length && catchUpTimerRef.current === null) {
      const rateScale = policy.catchUpFactor * speedMultiplier
      const runCatchUp = () => {
        const tickMs = resolveTickMs(policy.catchUpTickMs, contentRef.current.length)
        const advanced = advance(
          contentRef.current,
          displayedLenRef.current,
          CATCH_UP_CHARS_PER_SECOND * rateScale,
          CATCH_UP_MAX_CHARS_PER_SECOND * rateScale,
          tickMs,
          policy.directFinishGap,
        )
        if (!advanced) {
          catchUpTimerRef.current = null
          return
        }
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
        catchUpTimerRef.current = setTimeout(runCatchUp, tickMs)
      }
      catchUpTimerRef.current = setTimeout(
        runCatchUp,
        resolveTickMs(policy.catchUpTickMs, contentRef.current.length),
      )
    } else if (displayedLenRef.current >= content.length) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming, speedMultiplier, policy])

  useEffect(() => {
    if (!isStreaming) return

    clearCatchUp()

    const rateScale = policy.streamFactor * speedMultiplier
    const runStream = () => {
      const tickMs = resolveTickMs(policy.streamTickMs, contentRef.current.length)
      const advanced = advance(
        contentRef.current,
        displayedLenRef.current,
        BASE_CHARS_PER_SECOND * rateScale,
        MAX_CHARS_PER_SECOND * rateScale,
        tickMs,
        policy.directFinishGap,
      )
      if (advanced) {
        perfTrace.bump(PERF_TRACE_COUNTERS.smoothTicks)
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
      }
      // 末尾续期：与 useSmoothStream 一致，交给共享帧循环而不是独立定时器
      scheduleFrameTask(runStream, tickMs)
    }
    scheduleFrameTask(runStream, resolveTickMs(policy.streamTickMs, contentRef.current.length))

    return () => cancelFrameTask(runStream)
  }, [isStreaming, speedMultiplier, policy])

  useEffect(() => () => clearCatchUp(), [])


  return { displayedContent }
}
