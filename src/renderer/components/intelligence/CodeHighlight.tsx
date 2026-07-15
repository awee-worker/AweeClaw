/**
 * CodeHighlight - 基于 Shiki 的代码高亮 React 组件
 * 替代 react-syntax-highlighter 的 SyntaxHighlighter
 *
 * 特性：
 *  - 高亮器未就绪时显示纯文本
 *  - 流式输出时（isStreaming=true）显示纯文本，结束后自动高亮
 *  - 支持暗色/亮色主题切换
 *  - 自动缓存已高亮的代码块
 */
import React, { useMemo, useEffect, useState } from 'react'
import { highlightCode, extractInlineHtml, ensureReady, isHighlighterReady } from '@utils/shikiHighlighter'

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
 * 代码高亮组件
 */
export const CodeHighlight: React.FC<CodeHighlightProps> = React.memo(
  ({ code, language, isDark = true, isStreaming = false, fontSize = 13, className, inline = false }) => {
    const [ready, setReady] = useState(isHighlighterReady)

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

    // 流式或未就绪时显示纯文本，避免频繁高亮计算
    const showPlain = isStreaming || !ready

    const highlightedHtml = useMemo(() => {
      if (showPlain) return null
      const html = highlightCode(code, language, isDark)
      if (!html) return null
      return inline ? extractInlineHtml(html) : html
    }, [showPlain, code, language, isDark, inline])

    if (showPlain || !highlightedHtml) {
      return <PlainCode code={code} fontSize={fontSize} className={className} inline={inline} />
    }

    return <HighlightedCode html={highlightedHtml} fontSize={fontSize} className={className} inline={inline} />
  },
)

CodeHighlight.displayName = 'CodeHighlight'

export default CodeHighlight