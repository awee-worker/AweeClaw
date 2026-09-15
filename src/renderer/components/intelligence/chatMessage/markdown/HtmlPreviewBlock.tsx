/**
 * HTML 代码绘图预览组件
 * 支持沙箱 iframe 渲染、高度自适应、安全 CSP
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Play, ExternalLink, Copy, Check, RotateCcw } from 'lucide-react'
import { CodeBlockView } from '../blocks/CodeBlockView'

interface HtmlPreviewBlockProps {
  code: string
  fontSize: number
  isStreaming?: boolean
}

// 默认高度
const DEFAULT_HEIGHT = 320
const MIN_HEIGHT = 100
const MAX_HEIGHT = 800

// CSP 策略
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:;">`

function HtmlPreviewBlockBase({ code, fontSize, isStreaming }: HtmlPreviewBlockProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  // 清理代码
  const cleanCode = useMemo(() => {
    return code.replace(/^html\n?/, '').trim()
  }, [code])

  // 构建完整的 HTML 文档（注入 CSP）
  const fullHtml = useMemo(() => {
    if (!cleanCode) return ''

    // 检查是否已经是完整 HTML 文档
    const isFullDoc = cleanCode.includes('<!DOCTYPE') || cleanCode.includes('<html')

    if (isFullDoc) {
      // 在 <head> 中注入 CSP
      return cleanCode.replace(/<head>/i, `<head>${CSP_META}`)
    } else {
      // 包装成完整文档
      return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META}
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a1a;
      background: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      body {
        color: #e5e5e5;
        background: #1a1a1a;
      }
    }
  </style>
</head>
<body>
${cleanCode}
</body>
</html>`
    }
  }, [cleanCode])

  // 监听 iframe 高度消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'html-preview-resize') {
        const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, event.data.height))
        setHeight(newHeight)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // 运行 HTML 代码
  const handleRun = useCallback(() => {
    setIsRunning(true)
  }, [])

  // 停止运行
  const handleStop = useCallback(() => {
    setIsRunning(false)
    setHeight(DEFAULT_HEIGHT)
  }, [])

  // 重新运行
  const handleRerun = useCallback(() => {
    setIsRunning(false)
    setTimeout(() => setIsRunning(true), 50)
  }, [])

  // 复制代码
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cleanCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [cleanCode])

  // 在新窗口打开
  const handleOpenExternal = useCallback(() => {
    const blob = new Blob([fullHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // 延迟清理 blob URL
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [fullHtml])

  // 开始调整高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartY.current = e.clientY
    resizeStartHeight.current = height

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY.current
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resizeStartHeight.current + deltaY))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height])

  // 流式输出时不渲染预览
  if (isStreaming) {
    return (
      <CodeBlockView language="html" fontSize={fontSize} isStreaming={isStreaming}>
        {cleanCode}
      </CodeBlockView>
    )
  }

  return (
    <div className="relative group/html my-4 rounded-xl overflow-hidden border border-border/80 bg-surface/50">
      {/* 头部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-background-tertiary/50 border-b border-border/80">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted font-medium font-mono lowercase">
            html preview
          </span>
          {isRunning && (
            <span className="text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">
              running
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* 复制按钮 */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Copy HTML code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* 运行/停止按钮 */}
          {!isRunning ? (
            <button
              onClick={handleRun}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-sm font-medium"
              title="Run HTML code"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run</span>
            </button>
          ) : (
            <>
              <button
                onClick={handleRerun}
                className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
                title="Rerun"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleStop}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium"
                title="Stop"
              >
                Stop
              </button>
            </>
          )}

          {/* 在新窗口打开 */}
          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Open in new window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 预览区域 */}
      {isRunning && (
        <div className="relative">
          <div
            className="overflow-auto bg-white"
            style={{ height: `${height}px` }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={fullHtml}
              sandbox="allow-scripts"
              className="w-full h-full border-0"
              title="HTML Preview"
              onLoad={() => {
                // 尝试获取内容高度
                try {
                  if (iframeRef.current?.contentDocument?.body) {
                    const contentHeight = iframeRef.current.contentDocument.body.scrollHeight
                    if (contentHeight > 0) {
                      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, contentHeight + 32)))
                    }
                  }
                } catch (e) {
                  // 跨域限制，忽略
                }
              }}
            />
          </div>

          {/* 调整高度手柄 */}
          <div
            className={`h-2 bg-border/50 hover:bg-accent/30 cursor-row-resize flex items-center justify-center transition-colors ${isResizing ? 'bg-accent/30' : ''}`}
            onMouseDown={handleResizeStart}
          >
            <div className="w-8 h-1 bg-text-muted/30 rounded-full" />
          </div>
        </div>
      )}

      {/* 代码区域（折叠状态显示） */}
      {!isRunning && (
        <div className="max-h-48 overflow-auto">
          <CodeBlockView language="html" fontSize={fontSize} isStreaming={isStreaming}>
            {cleanCode}
          </CodeBlockView>
        </div>
      )}
    </div>
  )
}

export const HtmlPreviewBlock = React.memo(HtmlPreviewBlockBase)
HtmlPreviewBlock.displayName = 'HtmlPreviewBlock'