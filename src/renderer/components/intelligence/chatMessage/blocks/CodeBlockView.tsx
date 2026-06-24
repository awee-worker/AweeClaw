/**
 * 代码块视图
 * 基于 Shiki 高亮，支持折叠/展开和一键复制
 */
import React, { useState, useCallback, useMemo } from 'react'
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { CodeHighlight } from '../../CodeHighlight'
import { HintOverlay } from '../../../ui/HintOverlay'
import { useStore } from '@store'
import { themeManager } from '../../../../config/themeDefinition'

interface CodeBlockViewProps {
  language: string | undefined
  children: React.ReactNode
  fontSize: number
  isStreaming?: boolean
}

function CodeBlockViewBase({ language, children, fontSize, isStreaming }: CodeBlockViewProps) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const currentTheme = useStore(s => s.currentTheme)
  const theme = themeManager.getThemeById(currentTheme)
  const isDark = theme?.type === 'dark'

  /** 从子节点提取纯文本 */
  const codeText = useMemo(() => {
    let text = ''
    React.Children.forEach(children, child => {
      if (typeof child === 'string') {
        text += child
      } else if (Array.isArray(child)) {
        child.forEach(c => {
          if (typeof c === 'string') text += c
        })
      }
    })
    if (!text && typeof children === 'string') text = children
    return text.replace(/\n$/, '')
  }, [children])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [codeText])

  const handleToggle = useCallback(() => {
    setCollapsed(prev => !prev)
  }, [])

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border/80 bg-surface/50">
      <div
        className="flex items-center justify-between px-4 py-2 bg-background-tertiary/50 border-b border-border/80 cursor-pointer select-none"
        onClick={handleToggle}
        title={collapsed ? '展开代码' : '收起代码'}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted">
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
          <span className="text-[11px] text-text-muted font-medium font-mono lowercase">
            {language || 'text'}
          </span>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <HintOverlay content="Copy Code">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </HintOverlay>
        </div>
      </div>
      {!collapsed && (
        <div className="relative">
          <CodeHighlight
            code={codeText}
            language={language}
            isDark={isDark}
            isStreaming={isStreaming}
            fontSize={fontSize}
          />
        </div>
      )}
    </div>
  )
}

export const CodeBlockView = React.memo(CodeBlockViewBase)
CodeBlockView.displayName = 'CodeBlockView'
