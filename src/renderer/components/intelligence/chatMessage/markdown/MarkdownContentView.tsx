/**
 * Markdown 内容渲染视图
 * 集成流式平滑输出、URL 预处理、系统警告检测和自定义组件渲染
 */
import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../../../adapters/electronBridge'
import { openUrlInBrowser } from '@utils/browserLauncher'
import { toFullPath } from '@shared/toolkit/pathHelper'
import { logger } from '@shared/toolkit/LogEngine'
import { useSmoothStream } from '@hooks/useSmoothStream'
import { SystemAlert, parseSystemAlert } from '../../SystemAlert'

import { CodeBlockRenderer } from './CodeBlockRenderer'
import { cleanStreamingContent, decorateStreamingChildren } from './streamingDecorator'
import { preprocessUrls, convertLineBreaks, containsEmotionTags, replaceEmotionTagsWithHtml } from './textPreprocessor'
import { EmotionRenderer } from './EmotionRenderer'

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

interface MarkdownContentViewProps {
  content: string
  fontSize: number
  isStreaming?: boolean
  preserveLineBreaks?: boolean
}

function MarkdownContentViewBase({ content: rawContent, fontSize, isStreaming, preserveLineBreaks }: MarkdownContentViewProps) {
  const content = typeof rawContent === 'string' ? rawContent : String(rawContent ?? '')
  const language = useStore(s => s.language)

  /** 清理并预处理文本 */
  const cleanedContent = useMemo(() => {
    let result = isStreaming ? cleanStreamingContent(content) : content
    result = preprocessUrls(result)
    if (preserveLineBreaks) {
      result = convertLineBreaks(result)
    }
    // 处理表情标记
    if (containsEmotionTags(result)) {
      result = replaceEmotionTagsWithHtml(result)
    }
    return result
  }, [content, isStreaming, preserveLineBreaks])

  /** 检测系统警告 */
  const systemAlert = useMemo(() => {
    if (!isStreaming) {
      return parseSystemAlert(cleanedContent, language)
    }
    return null
  }, [cleanedContent, isStreaming, language])

  /** 移除系统警告部分后的内容 */
  const contentWithoutAlert = useMemo(() => {
    if (systemAlert) {
      return cleanedContent.replace(/⚠️\s*.+?(?:\n💡\s*.+)?$/s, '').trim()
    }
    return cleanedContent
  }, [cleanedContent, systemAlert])

  const { displayedContent: smoothContent } = useSmoothStream(contentWithoutAlert || '', !!isStreaming, 1.5)
  const enableBlockReveal = !!isStreaming

  const { workspacePath, openFile, setActiveFile } = useStore(useShallow(s => ({
    workspacePath: s.workspacePath,
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
  })))

  /** 打开文件预览 */
  const handleOpenFile = React.useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const resolvedPath = toFullPath(filePath, workspacePath)
    try {
      const fileContent = await api.file.read(resolvedPath)
      if (fileContent !== null) {
        openFile(resolvedPath, fileContent)
        setActiveFile(resolvedPath)
      }
    } catch (err) {
      logger.ui.warn('Failed to open file from markdown:', err)
    }
  }, [workspacePath, openFile, setActiveFile])

  /** 流式子节点装饰 */
  const renderStreamingChildren = React.useCallback((children: React.ReactNode) => {
    if (!isStreaming) return children
    return decorateStreamingChildren(children)
  }, [isStreaming])

  /** 自定义 Markdown 组件映射 */
  const markdownComponents = useMemo(() => ({
    code({ className, children, node, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children)
      const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
      const isInline = !isCodeBlock && !codeContent.includes('\n')

      const looksLikePath = isInline && (
        codeContent.includes('/') ||
        codeContent.includes('\\') ||
        codeContent.match(/\.(ts|tsx|js|jsx|vue|uvue|md|json|css|scss|less|html|go|rs|py|java|c|cpp|h|hpp)$/i)
      ) && !codeContent.includes(' ') && codeContent.length > 2

      if (isInline && looksLikePath) {
        return (
          <code
            className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all cursor-pointer hover:underline decoration-accent/50 underline-offset-2 transition-all"
            onClick={(e) => {
              e.preventDefault()
              handleOpenFile(codeContent)
            }}
            title="Click to open file"
            {...props}
          >
            {children}
          </code>
        )
      }

      return isInline ? (
        <code className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all" {...props}>
          {children}
        </code>
      ) : (
        <div className="w-full relative">
          <CodeBlockRenderer language={match?.[1]} fontSize={fontSize} isStreaming={isStreaming}>{children}</CodeBlockRenderer>
        </div>
      )
    },
    pre: ({ children }: any) => <div className={`overflow-x-auto max-w-full ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</div>,
    p: ({ children }: any) => <p className={`mb-3 last:mb-0 leading-7 break-words ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</p>,
    ul: ({ children }: any) => <ul className={`list-disc pl-5 mb-3 space-y-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</ul>,
    ol: ({ children }: any) => <ol className={`list-decimal pl-5 mb-3 space-y-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</ol>,
    li: ({ children }: any) => <li className={`pl-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</li>,
    a: ({ href, children }: any) => {
      const cleanHref = href ? href.replace(/[*_~`#|]+$/g, '').replace(/^[*_~`#|]+/g, '').trim() : href
      return (
        <a
          href={cleanHref}
          target="_blank"
          className="text-accent hover:underline decoration-accent/50 underline-offset-2 font-medium"
          onClick={(e) => {
            e.preventDefault()
            if (cleanHref) openUrlInBrowser(cleanHref)
          }}
        >{renderStreamingChildren(children)}</a>
      )
    },
    strong: ({ children, ...props }: any) => <strong {...props}>{renderStreamingChildren(children)}</strong>,
    em: ({ children, ...props }: any) => <em {...props}>{renderStreamingChildren(children)}</em>,
    blockquote: ({ children }: any) => (
      <blockquote className={`border-l-4 border-accent/30 pl-4 my-4 text-text-muted italic bg-surface/20 py-2 rounded-r ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</blockquote>
    ),
    h1: ({ children }: any) => <h1 className={`text-2xl font-bold mb-4 mt-6 first:mt-0 text-text-primary tracking-tight ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h1>,
    h2: ({ children }: any) => <h2 className={`text-xl font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h2>,
    h3: ({ children }: any) => <h3 className={`text-lg font-semibold mb-2 mt-4 first:mt-0 text-text-primary ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h3>,
    table: ({ children }: any) => (
      <div className={`overflow-x-auto my-4 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>
        <table className="min-w-full border-collapse border border-border">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-surface/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border hover:bg-surface-hover transition-colors">{children}</tr>,
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-text-primary text-left font-semibold text-text-primary">{renderStreamingChildren(children)}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{renderStreamingChildren(children)}</td>,
    span: ({ className, children, ...props }: any) => {
      // 处理表情占位符
      if (className === 'emotion-placeholder') {
        const emotionName = props['data-emotion']
        if (emotionName) {
          return <EmotionRenderer emotionTag={`[emo:${emotionName}]`} language={language} />
        }
      }
      return <span className={className} {...props}>{children}</span>
    },
  }), [enableBlockReveal, fontSize, handleOpenFile, isStreaming, renderStreamingChildren, language])

  if (!contentWithoutAlert && !systemAlert) {
    return null
  }

  return (
    <>
      {systemAlert && (
        <SystemAlert
          type={systemAlert.type}
          title={systemAlert.title}
          message={systemAlert.message}
          suggestion={systemAlert.suggestion}
        />
      )}
      {contentWithoutAlert && (
        <div
          style={{ fontSize: `${fontSize}px` }}
          className={`text-text-primary/90 leading-relaxed tracking-wide overflow-hidden ${isStreaming ? 'streaming-ink-effect' : ''}`}
        >
          <ReactMarkdown
            className="prose prose-invert max-w-none"
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            components={markdownComponents}
            skipHtml
          >
            {smoothContent}
          </ReactMarkdown>
        </div>
      )}
    </>
  )
}

export const MarkdownContentView = React.memo(MarkdownContentViewBase)
MarkdownContentView.displayName = 'MarkdownContentView'
