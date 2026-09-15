/**
 * 代码块分发器
 * 根据语言类型分发到不同的渲染器：mermaid / html / 普通代码块
 */
import React, { useMemo } from 'react'
import { MermaidBlock } from './MermaidBlock'
import { HtmlPreviewBlock } from './HtmlPreviewBlock'
import { CodeBlockView } from '../blocks/CodeBlockView'

interface CodeBlockRendererProps {
  language: string | undefined
  children: React.ReactNode
  fontSize: number
  isStreaming?: boolean
}

// 支持的特殊语言类型
const MERMAID_LANGUAGES = ['mermaid']
const HTML_LANGUAGES = ['html', 'htm', 'htmlpreview', 'html-preview']

function CodeBlockRendererBase({ language, children, fontSize, isStreaming }: CodeBlockRendererProps) {
  // 提取代码文本
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

  // 判断语言类型
  const normalizedLanguage = language?.toLowerCase().trim()
  const isMermaid = MERMAID_LANGUAGES.includes(normalizedLanguage || '')
  const isHtml = HTML_LANGUAGES.includes(normalizedLanguage || '')

  // mermaid 代码块
  if (isMermaid) {
    return (
      <MermaidBlock
        code={codeText}
        fontSize={fontSize}
        isStreaming={isStreaming}
        isComplete={!isStreaming}
      />
    )
  }

  // HTML 代码绘图
  if (isHtml) {
    return (
      <HtmlPreviewBlock
        code={codeText}
        fontSize={fontSize}
        isStreaming={isStreaming}
      />
    )
  }

  // 普通代码块
  return (
    <CodeBlockView language={language} fontSize={fontSize} isStreaming={isStreaming}>
      {children}
    </CodeBlockView>
  )
}

export const CodeBlockRenderer = React.memo(CodeBlockRendererBase)
CodeBlockRenderer.displayName = 'CodeBlockRenderer'