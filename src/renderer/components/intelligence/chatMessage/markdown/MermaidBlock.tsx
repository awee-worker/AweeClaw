/**
 * Mermaid 代码块渲染组件
 * 支持懒加载、缓存、错误降级、流式兼容和主题同步
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useMermaid } from './useMermaid'
import { CodeBlockView } from '../blocks/CodeBlockView'
import { Loader2, AlertCircle, Copy, Check } from 'lucide-react'
import { useStore } from '@store'

interface MermaidBlockProps {
  code: string
  fontSize: number
  isStreaming?: boolean
  isComplete?: boolean // 代码块是否闭合
}

function MermaidBlockBase({ code, fontSize, isStreaming, isComplete = true }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { render, debouncedRender, cancelPendingRender, isLoading, error, isValidSyntax } = useMermaid()
  const currentTheme = useStore(s => s.currentTheme)

  // 清理代码（移除可能的标记）
  const cleanCode = useMemo(() => {
    return code.replace(/^mermaid\n?/, '').trim()
  }, [code])

  // 检查是否是有效的 mermaid 语法
  const isValid = useMemo(() => {
    return isValidSyntax(cleanCode)
  }, [cleanCode, isValidSyntax])

  // 流式输出时的处理
  useEffect(() => {
    if (isStreaming && !isComplete) {
      // 流式输出未完成，不渲染，显示普通代码块
      cancelPendingRender()
      setSvg(null)
      setRenderError(null)
      return
    }

    if (!isValid) {
      setRenderError('Invalid mermaid syntax')
      return
    }

    // 流式输出完成或非流式模式，开始渲染
    if (isStreaming && isComplete) {
      // 流式完成，使用防抖渲染
      debouncedRender(cleanCode, (result) => {
        if (result) {
          setSvg(result)
          setRenderError(null)
        } else {
          setSvg(null)
          setRenderError(error || 'Failed to render mermaid diagram')
        }
      })
    } else {
      // 非流式模式，直接渲染
      render(cleanCode).then((result) => {
        if (result) {
          setSvg(result)
          setRenderError(null)
        } else {
          setSvg(null)
          setRenderError(error || 'Failed to render mermaid diagram')
        }
      })
    }
  }, [cleanCode, isStreaming, isComplete, isValid, render, debouncedRender, cancelPendingRender, error])

  // 主题变化时重新渲染
  useEffect(() => {
    if (svg && isValid && !isStreaming) {
      render(cleanCode).then((result) => {
        if (result) {
          setSvg(result)
          setRenderError(null)
        }
      })
    }
  }, [currentTheme])

  // 复制代码
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cleanCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [cleanCode])

  // 错误状态或无效语法，降级为普通代码块
  if (renderError || !isValid) {
    return (
      <div className="relative">
        <CodeBlockView language="mermaid" fontSize={fontSize} isStreaming={isStreaming}>
          {cleanCode}
        </CodeBlockView>
        {renderError && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Mermaid syntax error</p>
              <p className="text-red-300/80 text-xs mt-1">{renderError}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 加载状态
  if (isLoading) {
    return (
      <div className="relative">
        <CodeBlockView language="mermaid" fontSize={fontSize} isStreaming={isStreaming}>
          {cleanCode}
        </CodeBlockView>
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 backdrop-blur-sm rounded-xl">
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Rendering diagram...</span>
          </div>
        </div>
      </div>
    )
  }

  // 渲染成功
  if (svg) {
    return (
      <div className="relative group/mermaid my-4 rounded-xl overflow-hidden border border-border/80 bg-surface/50">
        {/* 头部工具栏 */}
        <div className="flex items-center justify-between px-4 py-2 bg-background-tertiary/50 border-b border-border/80">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted font-medium font-mono lowercase">
              mermaid diagram
            </span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover/mermaid:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              title="Copy mermaid code"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* SVG 渲染区域 */}
        <div
          className="mermaid-container p-4 overflow-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    )
  }

  // 默认状态（应该不会到达这里）
  return (
    <CodeBlockView language="mermaid" fontSize={fontSize} isStreaming={isStreaming}>
      {cleanCode}
    </CodeBlockView>
  )
}

export const MermaidBlock = React.memo(MermaidBlockBase)
MermaidBlock.displayName = 'MermaidBlock'