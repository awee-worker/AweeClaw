/**
 * MiniMarkdown - 迷你聊天专用的轻量级 Markdown 渲染组件
 *
 * 与主窗口的 MarkdownContentView 区别：
 * - 不依赖主窗口的 Zustand store（头像窗口有独立 store）
 * - 不使用 useSmoothStream（迷你窗口直接渲染流式文本）
 * - 不包含文件预览、系统警告等高级功能
 * - 支持基础 Markdown：标题、列表、代码块、行内代码、链接、表格、引用
 *
 * 使用 react-markdown + remark-gfm，与主窗口使用相同的底层库
 */

import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MiniMarkdownProps {
  content: string
  isStreaming?: boolean
}

function MiniMarkdownImpl({ content, isStreaming }: MiniMarkdownProps) {
  // 流式输出时清理不完整的 Markdown 标记（如未闭合的代码块）
  const cleanedContent = useMemo(() => {
    if (!content) return ''
    if (!isStreaming) return content

    // 流式输出时检测未闭合的代码块，暂时隐藏不完整部分
    const codeBlockCount = (content.match(/```/g) || []).length
    if (codeBlockCount % 2 !== 0) {
      // 有未闭合的代码块：截断到最后一个完整的 ```
      const lastOpenIndex = content.lastIndexOf('```')
      const beforeCode = content.substring(0, lastOpenIndex)
      const codeContent = content.substring(lastOpenIndex + 3)
      // 如果代码块内容为空或太短，不显示代码块标记
      if (codeContent.trim().length === 0) {
        return beforeCode.trimEnd()
      }
      // 显示已收到的代码块内容（但不闭合）
      return beforeCode + '```\n' + codeContent
    }

    return content
  }, [content, isStreaming])

  return (
    <div style={containerStyle}>
      <ReactMarkdown remarkPlugins={MINI_MARKDOWN_REMARK_PLUGINS} components={MINI_MARKDOWN_COMPONENTS}>
        {cleanedContent}
      </ReactMarkdown>
    </div>
  )
}

/**
 * 插件与组件映射提升到模块级
 *
 * 这两个值一旦内联在组件里，每次渲染都会产生新引用，会让 react-markdown
 * 与其内部节点无法复用；迷你面板每次同步主窗口对话都会重渲染整列消息，
 * 稳定引用能把开销压到只处理真正变化的内容。
 */
const MINI_MARKDOWN_REMARK_PLUGINS = [remarkGfm]

const MINI_MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  pre: ({ children }) => <pre style={codeBlockStyle}>{children}</pre>,
  code: ({ className, children, ...props }) => {
    // 行内代码 vs 代码块内的 code
    const isInline = !className
    if (isInline) {
      return (
        <code style={inlineCodeStyle} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className={className} style={codeStyle} {...props}>
        {children}
      </code>
    )
  },
  h1: ({ children }) => <h1 style={h1Style}>{children}</h1>,
  h2: ({ children }) => <h2 style={h2Style}>{children}</h2>,
  h3: ({ children }) => <h3 style={h3Style}>{children}</h3>,
  h4: ({ children }) => <h4 style={h4Style}>{children}</h4>,
  p: ({ children }) => <p style={pStyle}>{children}</p>,
  ul: ({ children }) => <ul style={ulStyle}>{children}</ul>,
  ol: ({ children }) => <ol style={olStyle}>{children}</ol>,
  li: ({ children }) => <li style={liStyle}>{children}</li>,
  blockquote: ({ children }) => <blockquote style={blockquoteStyle}>{children}</blockquote>,
  a: ({ href, children }) => (
    <a
      href={href}
      style={linkStyle}
      onClick={(e) => {
        e.preventDefault()
        // 通过 window.open 在外部浏览器打开
        if (href) {
          try {
            window.open(href, '_blank', 'noopener,noreferrer')
          } catch {
            /* noop */
          }
        }
      }}
    >
      {children}
    </a>
  ),
  table: ({ children }) => <table style={tableStyle}>{children}</table>,
  th: ({ children }) => <th style={thStyle}>{children}</th>,
  td: ({ children }) => <td style={tdStyle}>{children}</td>,
  hr: () => <hr style={hrStyle} />,
  strong: ({ children }) => <strong style={strongStyle}>{children}</strong>,
  em: ({ children }) => <em style={emStyle}>{children}</em>,
}

// ============================================
// 样式（使用 CSS 变量跟随主题）
// ============================================

const containerStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.55,
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  wordBreak: 'break-word',
}

const codeBlockStyle: React.CSSProperties = {
  background: 'rgb(var(--background) / 0.5)',
  border: '1px solid rgb(var(--border) / 0.3)',
  borderRadius: 8,
  padding: '8px 10px',
  overflowX: 'auto',
  margin: '6px 0',
  fontSize: '12px',
}

const codeStyle: React.CSSProperties = {
  fontFamily: '"Menlo", "Monaco", "Consolas", "Courier New", monospace',
  fontSize: '12px',
  background: 'transparent',
  color: 'rgb(var(--text-primary) / 0.9)',
}

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: '"Menlo", "Monaco", "Consolas", "Courier New", monospace',
  fontSize: '12px',
  background: 'rgb(var(--surface) / 0.6)',
  padding: '1px 5px',
  borderRadius: 4,
  color: 'rgb(var(--accent) / 0.9)',
}

const h1Style: React.CSSProperties = {
  fontSize: '16px', fontWeight: 700, margin: '8px 0 4px',
  color: 'rgb(var(--text-primary))',
}

const h2Style: React.CSSProperties = {
  fontSize: '15px', fontWeight: 700, margin: '8px 0 4px',
  color: 'rgb(var(--text-primary))',
}

const h3Style: React.CSSProperties = {
  fontSize: '14px', fontWeight: 600, margin: '6px 0 3px',
  color: 'rgb(var(--text-primary))',
}

const h4Style: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, margin: '6px 0 3px',
  color: 'rgb(var(--text-primary) / 0.9)',
}

const pStyle: React.CSSProperties = {
  margin: '4px 0',
}

const ulStyle: React.CSSProperties = {
  margin: '4px 0', paddingLeft: 18,
}

const olStyle: React.CSSProperties = {
  margin: '4px 0', paddingLeft: 18,
}

const liStyle: React.CSSProperties = {
  margin: '2px 0',
}

const blockquoteStyle: React.CSSProperties = {
  margin: '6px 0', paddingLeft: 10,
  borderLeft: '3px solid rgb(var(--accent) / 0.5)',
  color: 'rgb(var(--text-secondary) / 0.9)',
}

const linkStyle: React.CSSProperties = {
  color: 'rgb(var(--accent))',
  textDecoration: 'none',
  cursor: 'pointer',
}

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse', width: '100%', margin: '6px 0',
  fontSize: '12px',
}

const thStyle: React.CSSProperties = {
  border: '1px solid rgb(var(--border) / 0.4)',
  padding: '4px 8px', textAlign: 'left',
  background: 'rgb(var(--surface) / 0.4)',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  border: '1px solid rgb(var(--border) / 0.4)',
  padding: '4px 8px',
}

const hrStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid rgb(var(--border) / 0.4)',
  margin: '8px 0',
}

const strongStyle: React.CSSProperties = {
  fontWeight: 700,
  color: 'rgb(var(--text-primary))',
}

const emStyle: React.CSSProperties = {
  fontStyle: 'italic',
}

export const MiniMarkdown = memo(MiniMarkdownImpl)
