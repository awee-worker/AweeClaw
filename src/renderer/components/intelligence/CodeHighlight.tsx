/**
 * CodeHighlight - 基于 Shiki 的代码高亮 React 组件
 * 替代 react-syntax-highlighter 的 SyntaxHighlighter
 *
 * 特性：
 *  - 高亮器未就绪时显示纯文本
 *  - 流式输出时（isStreaming=true）显示纯文本，结束后自动高亮
 *  - 支持暗色/亮色主题切换
 *  - 自动缓存已高亮的代码块
 *  - 高亮在空闲时段执行，不阻塞渲染提交
 */
import React, { useMemo, useEffect, useState } from 'react'
import { highlightCode, extractInlineHtml, ensureReady, isHighlighterReady } from '@utils/shikiHighlighter'
import * as perfTrace from '@intelligence/diagnostics/perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

export interface CodeHighlightProps {
  /** 代码文本 */
  code: string
  /** 编程语言 */
  language?: string
  /** 是否暗色主题 */
  isDark?: boolean
  /** 是否正在流式输出（流式时不触发高亮，避免频繁重绘） */
  isStreaming?: boolean
  /** 字体大小（px） */
  fontSize?: number
  /** 额外 className */
  className?: string
  /** 行内模式（用于 diff 逐行展示，去掉 <pre> 包装） */
  inline?: boolean
}

/**
 * 纯文本展示组件（兜底 + 流式状态）
 */
const PlainCode: React.FC<{ code: string; fontSize: number; className?: string; inline?: boolean }> = React.memo(
  ({ code, fontSize, className, inline }) => {
    if (inline) {
      return (
        <code
          className={`!bg-transparent !m-0 font-mono leading-relaxed ${className || ''}`}
          style={{ fontSize: `${fontSize}px` }}
        >
          {code}
        </code>
      )
    }
    return (
      <pre
        className={`!bg-transparent !p-4 !m-0 custom-scrollbar overflow-x-auto leading-relaxed font-mono ${className || ''}`}
        style={{ fontSize: `${fontSize}px`, tabSize: 2 }}
      >
        <code>{code}</code>
      </pre>
    )
  },
)
PlainCode.displayName = 'PlainCode'

/**
 * Shiki 高亮展示组件
 */
const HighlightedCode: React.FC<{
  html: string
  fontSize: number
  className?: string
  inline?: boolean
}> = React.memo(({ html, fontSize, className, inline }) => {
  if (inline) {
    return (
      <code
        className={`!bg-transparent !m-0 font-mono leading-relaxed [&_span]:!font-mono ${className || ''}`}
        style={{ fontSize: `${fontSize}px` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <div
      className={`!bg-transparent !p-4 !m-0 custom-scrollbar overflow-x-auto leading-relaxed font-mono [&>pre]:!bg-transparent [&>pre]:!m-0 [&>pre]:!p-0 [&>pre]:!text-[inherit] [&_code]:!font-mono ${className || ''}`}
      style={{ fontSize: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
HighlightedCode.displayName = 'HighlightedCode'

/**
 * 空闲调度的兜底时限（毫秒）
 *
 * 空闲回调只在浏览器有余量时执行，长时间高负载下可能一直排不到，因此需要一个
 * 上限：超过它就必须执行，否则代码块会永远停在无高亮的纯文本状态。
 */
const HIGHLIGHT_IDLE_TIMEOUT_MS = 400

/** 已调度的任务句柄：必须带来源标记，两条取消通道的句柄都是数字，无法靠类型区分 */
interface ScheduledWork {
  kind: 'idle' | 'timer'
  handle: number | ReturnType<typeof setTimeout>
}

interface IdleCapableWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/**
 * 把高亮计算调度到空闲时段
 *
 * Shiki 同步跑一次语法规则的成本随代码长度上升（实测 5 千字符约 26ms），
 * 而它此前发生在渲染提交路径上：一张 diff 卡片有几十行、每行一个高亮组件，
 * 全部计算被压进同一个任务，单次可累积到数百毫秒。
 *
 * 挪到空闲回调后，每个组件各自成为独立任务，浏览器在任务之间仍能响应输入与绘制，
 * 卡顿从「一次长阻塞」变成「多次短占用」。这里只改执行时机，不改高亮结果。
 */
function scheduleHighlight(run: () => void): ScheduledWork {
  const idleWindow = typeof window !== 'undefined' ? (window as IdleCapableWindow) : undefined
  if (idleWindow?.requestIdleCallback) {
    return {
      kind: 'idle',
      handle: idleWindow.requestIdleCallback(run, { timeout: HIGHLIGHT_IDLE_TIMEOUT_MS }),
    }
  }
  return { kind: 'timer', handle: setTimeout(run, 0) }
}

/** 取消尚未执行的高亮调度 */
function cancelHighlight(work: ScheduledWork): void {
  if (work.kind === 'idle') {
    const idleWindow = typeof window !== 'undefined' ? (window as IdleCapableWindow) : undefined
    if (idleWindow?.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(work.handle as number)
      return
    }
    return
  }
  clearTimeout(work.handle as ReturnType<typeof setTimeout>)
}

/**
 * 代码高亮组件
 *
 * 渲染始终先出纯文本，高亮结果在空闲时段算好后替换：这样组件挂载的代价只与
 * 文本长度有关，与语法解析无关，挂载期间不再产生长任务。
 */
export const CodeHighlight: React.FC<CodeHighlightProps> = React.memo(
  ({ code, language, isDark = true, isStreaming = false, fontSize = 13, className, inline = false }) => {
    const [ready, setReady] = useState(isHighlighterReady)
    const [highlighted, setHighlighted] = useState<{ key: string; html: string } | null>(null)

    // 确保高亮器已加载
    useEffect(() => {
      if (ready) return
      let cancelled = false
      ensureReady().then(() => {
        if (!cancelled) setReady(true)
      }).catch(() => {
        if (!cancelled) setReady(true) // 失败也显示，走纯文本兜底
      })
      return () => { cancelled = true }
    }, [ready])

    /**
     * 高亮输入指纹
     *
     * 只在这里做一次拼接：依赖数组的逐项比较本身就要遍历字符串，把比较结果固化成
     * 一个引用稳定的短字符串，后续判断「缓存的高亮结果是否还对应当前输入」就是 O(1)。
     */
    const specKey = useMemo(
      () => `${language ?? ''}\u0000${isDark ? 'd' : 'l'}\u0000${inline ? 'i' : 'b'}\u0000${code}`,
      [code, language, isDark, inline],
    )

    useEffect(() => {
      // 流式期间文本每帧都在变，高亮必然被丢弃，索性不算
      if (isStreaming || !ready) return

      let cancelled = false
      const handle = scheduleHighlight(() => {
        if (cancelled) return
        const tracking = perfTrace.isEnabled()
        const startedAt = tracking ? performance.now() : 0

        const raw = highlightCode(code, language, isDark)
        setHighlighted({ key: specKey, html: inline ? extractInlineHtml(raw) : raw })

        if (tracking) {
          perfTrace.bump(PERF_TRACE_COUNTERS.highlightCalls)
          perfTrace.bump(PERF_TRACE_COUNTERS.highlightMs, performance.now() - startedAt)
        }
      })

      return () => {
        cancelled = true
        cancelHighlight(handle)
      }
    }, [specKey, code, language, isDark, inline, isStreaming, ready])

    // 指纹不匹配说明手上的结果属于上一份内容，退回纯文本，避免闪过错误的高亮
    const html = highlighted?.key === specKey ? highlighted.html : null

    if (!html) {
      return <PlainCode code={code} fontSize={fontSize} className={className} inline={inline} />
    }

    return <HighlightedCode html={html} fontSize={fontSize} className={className} inline={inline} />
  },
)

CodeHighlight.displayName = 'CodeHighlight'

export default CodeHighlight