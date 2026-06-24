import { useState, useEffect, useRef } from 'react'
import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 流式期间每帧推进间隔（毫秒） */
const STREAM_TICK_MS = 66

/** 收尾动画每帧推进间隔（毫秒） */
const CATCH_UP_TICK_MS = 50

/** 间距小于等于此值时一次性补齐，避免逐字符抖动 */
const DIRECT_FINISH_GAP = 3

/** 流式期间每帧推进比例 */
const STREAM_FACTOR = 0.15

/** 收尾动画每帧推进比例 */
const CATCH_UP_FACTOR = 0.25

/** 计算单步推进字符数 */
function computeStep(gap: number, factor: number): number {
  if (gap <= DIRECT_FINISH_GAP) return gap
  return Math.max(1, Math.ceil(gap * factor))
}

/** 推进显示长度并返回新内容切片 */
function advance(
  content: string,
  currentLen: number,
  factor: number,
): { nextLen: number; slice: string } | null {
  const target = content.length
  if (currentLen >= target) return null
  const step = computeStep(target - currentLen, factor)
  const nextLen = Math.min(target, currentLen + step)
  return { nextLen, slice: content.slice(0, nextLen) }
}

/**
 * 平滑流式文本插值器
 *
 * 在流式输出期间按固定时间步推进显示长度，收尾时以更高比例补齐剩余内容，
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
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 清理收尾动画定时器 */
  const clearCatchUp = () => {
    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }
  }

  /** 清理流式定时器 */
  const clearStream = () => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
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
      const factor = CATCH_UP_FACTOR * speedMultiplier
      const runCatchUp = () => {
        const advanced = advance(contentRef.current, displayedLenRef.current, factor)
        if (!advanced) {
          catchUpTimerRef.current = null
          return
        }
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
        catchUpTimerRef.current = setTimeout(runCatchUp, CATCH_UP_TICK_MS)
      }
      catchUpTimerRef.current = setTimeout(runCatchUp, CATCH_UP_TICK_MS)
    } else if (displayedLenRef.current >= content.length) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming, speedMultiplier])

  // 流式期间推进循环
  useEffect(() => {
    if (!isStreaming) return

    clearCatchUp()

    const factor = STREAM_FACTOR * speedMultiplier
    const runStream = () => {
      const advanced = advance(contentRef.current, displayedLenRef.current, factor)
      if (advanced) {
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
      }
      streamTimerRef.current = setTimeout(runStream, STREAM_TICK_MS)
    }
    streamTimerRef.current = setTimeout(runStream, STREAM_TICK_MS)

    return clearStream
  }, [isStreaming, speedMultiplier])

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      clearCatchUp()
      clearStream()
    }
  }, [])

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
  /** 流式推进比例 */
  streamFactor: number
  /** 收尾推进比例 */
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
    streamFactor: 0.15,
    catchUpFactor: 0.25,
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
    streamFactor: 0.25,
    catchUpFactor: 0.35,
    enableSmoothAnimation: true,
    directFinishGap: 5,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    streamTickMs: 66,
    catchUpTickMs: 50,
    streamFactor: 0.15,
    catchUpFactor: 0.25,
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
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCatchUp = () => {
    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }
  }

  const clearStream = () => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
  }

  const computeStepWithPolicy = (gap: number, factor: number): number => {
    if (gap <= policy.directFinishGap) return gap
    return Math.max(1, Math.ceil(gap * factor))
  }

  const advanceWithPolicy = (
    content: string,
    currentLen: number,
    factor: number,
  ): { nextLen: number; slice: string } | null => {
    const target = content.length
    if (currentLen >= target) return null
    const step = computeStepWithPolicy(target - currentLen, factor)
    const nextLen = Math.min(target, currentLen + step)
    return { nextLen, slice: content.slice(0, nextLen) }
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
      const factor = policy.catchUpFactor * speedMultiplier
      const runCatchUp = () => {
        const advanced = advanceWithPolicy(contentRef.current, displayedLenRef.current, factor)
        if (!advanced) {
          catchUpTimerRef.current = null
          return
        }
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
        catchUpTimerRef.current = setTimeout(runCatchUp, policy.catchUpTickMs)
      }
      catchUpTimerRef.current = setTimeout(runCatchUp, policy.catchUpTickMs)
    } else if (displayedLenRef.current >= content.length) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming, speedMultiplier, policy])

  useEffect(() => {
    if (!isStreaming) return

    clearCatchUp()

    const factor = policy.streamFactor * speedMultiplier
    const runStream = () => {
      const advanced = advanceWithPolicy(contentRef.current, displayedLenRef.current, factor)
      if (advanced) {
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
      }
      streamTimerRef.current = setTimeout(runStream, policy.streamTickMs)
    }
    streamTimerRef.current = setTimeout(runStream, policy.streamTickMs)

    return clearStream
  }, [isStreaming, speedMultiplier, policy])

  useEffect(() => {
    return () => {
      clearCatchUp()
      clearStream()
    }
  }, [])

  return { displayedContent }
}
