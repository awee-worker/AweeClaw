/**
 * Markdown 内容渲染视图
 * 集成流式平滑输出、URL 预处理、系统警告检测和自定义组件渲染
 */
import React, { useMemo, useRef } from 'react'
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
import { decorateStreamingChildren } from './streamingDecorator'
import { EmotionRenderer } from './EmotionRenderer'
import { IncrementalBlockSplitter } from './markdownBlocks'
import { IncrementalTextCleaner } from './incrementalTextCleaner'
import * as perfTrace from '@intelligence/diagnostics/perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

interface MarkdownContentViewProps {
  content: string
  fontSize: number
  isStreaming?: boolean
  preserveLineBreaks?: boolean
}

/** 自定义组件映射类型（直接取自 ReactMarkdown 的 props，避免类型漂移） */
type MarkdownComponents = React.ComponentProps<typeof ReactMarkdown>['components']

/**
 * 单个 Markdown 块的渲染单元
 *
 * 块由 splitMarkdownBlocks 切出：除末尾块外，其余块在流式期间内容不再变化，
 * 因此可被 React.memo 短路，避免每次刷新都重新解析整篇文档。
 */
const MarkdownBlock = React.memo(function MarkdownBlock({
  content,
  components,
}: {
  content: string
  components: MarkdownComponents
}) {
  // 记忆化命中时组件体不会执行，因此这两个计数等于「真正重新解析的块数与其体积」，
  // 而不是「被渲染的块数」——两者之差就是分块复用省下的工作量。体积要与次数
  // 一起看：次数少但单体巨大，解析开销同样会随块长线性上升。
  perfTrace.bump(PERF_TRACE_COUNTERS.blockParses)
  perfTrace.bump(PERF_TRACE_COUNTERS.blockChars, content.length)
  return (
    <ReactMarkdown
      className="prose prose-invert max-w-none"
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      components={components}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  )
})
MarkdownBlock.displayName = 'MarkdownBlock'

/**
 * 流式中的围栏代码块
 *
 * 尾块落在未闭合围栏内时，全部内容都是代码文本，没有必要走 Markdown 解析：
 * 直接交给代码块组件后，每帧只更新一个文本节点，而不是重建整棵节点树。
 * 代码块常常一次输出上百行，而刷新周期约 66ms，这一段是流式渲染里最贵的形态。
 *
 * 外壳沿用与正式渲染相同的组件，围栏闭合切回 Markdown 渲染时不会发生跳动。
 */
const StreamingFenceBlock = React.memo(function StreamingFenceBlock({
  block,
  language,
  fontSize,
}: {
  block: string
  language: string
  fontSize: number
}) {
  // 计一帧：这一项与 blockParses 此消彼长，用来看围栏分流实际拦下了多少解析
  perfTrace.bump(PERF_TRACE_COUNTERS.fenceTailRenders)

  /** 首行是围栏开启行，其余为代码正文 */
  const codeText = useMemo(() => {
    const firstNewline = block.indexOf('\n')
    return firstNewline === -1 ? '' : block.slice(firstNewline + 1)
  }, [block])

  return (
    <div className="w-full relative">
      <CodeBlockRenderer language={language} fontSize={fontSize} isStreaming>
        {codeText}
      </CodeBlockRenderer>
    </div>
  )
})
StreamingFenceBlock.displayName = 'StreamingFenceBlock'

function MarkdownContentViewBase({ content: rawContent, fontSize, isStreaming, preserveLineBreaks }: MarkdownContentViewProps) {
  const content = typeof rawContent === 'string' ? rawContent : String(rawContent ?? '')
  const language = useStore(s => s.language)

  /**
   * 清洗器与分块器按组件实例持有：两者都靠「上轮结果 + 本轮增量」工作，
   * 状态必须跟着这个渲染单元走。实例在首次渲染时惰性创建，此后的
   * 重新渲染（流式期间每 66ms 一次）复用同一份缓存。
   */
  const cleanerRef = useRef<IncrementalTextCleaner | null>(null)
  if (cleanerRef.current === null) cleanerRef.current = new IncrementalTextCleaner()
  const splitterRef = useRef<IncrementalBlockSplitter | null>(null)
  if (splitterRef.current === null) splitterRef.current = new IncrementalBlockSplitter()

  /** 清理并预处理文本（按行增量，只处理新增行与末行） */
  const cleanedContent = useMemo(() => {
    const cleaner = cleanerRef.current as IncrementalTextCleaner
    const tracking = perfTrace.isEnabled()
    const startedAt = tracking ? performance.now() : 0

    const result = cleaner.update(content, {
      streaming: !!isStreaming,
      preserveLineBreaks: !!preserveLineBreaks,
    })

    if (tracking) {
      perfTrace.bump(PERF_TRACE_COUNTERS.cleanCalls)
      perfTrace.bump(PERF_TRACE_COUNTERS.cleanMs, performance.now() - startedAt)
      perfTrace.bump(PERF_TRACE_COUNTERS.cleanReusedLines, cleaner.reused)
      perfTrace.bump(PERF_TRACE_COUNTERS.cleanFenceSkipped, cleaner.fenceSkipped)
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

  /**
   * 流式插值结果直接参与渲染。
   *
   * 这里曾叠加过 useDeferredValue 来合并中间态，但插值器本身已按 66ms 节拍推进，
   * 而外部 store 每收到一块内容就会触发同步更新，低优先级的 deferred 渲染会被反复
   * 打断并重启，流式内容只能等输出结束、更新停止后才提交，表现为「结束后一次性出现」。
   */
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

  /**
   * 按块切分待渲染文本
   *
   * 流式期间 smoothContent 每个刷新周期都会增长，直接整篇重新解析 Markdown
   * 会让开销随文本长度线性上升。切分后已完成的前缀块内容稳定，交给
   * MarkdownBlock 的 memo 短路，只有末尾块真正参与解析。
   */
  const { blocks, tailFence } = useMemo(() => {
    const splitter = splitterRef.current as IncrementalBlockSplitter
    const tracking = perfTrace.isEnabled()
    const startedAt = tracking ? performance.now() : 0

    const result = splitter.update(smoothContent || '')

    if (tracking) {
      perfTrace.bump(PERF_TRACE_COUNTERS.splitCalls)
      perfTrace.bump(PERF_TRACE_COUNTERS.splitMs, performance.now() - startedAt)
      perfTrace.bump(PERF_TRACE_COUNTERS.splitReusedBlocks, splitter.reused)
    }

    return { blocks: result, tailFence: splitter.tailFence }
  }, [smoothContent])

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
      {blocks.length > 0 && (
        <div
          style={{ fontSize: `${fontSize}px` }}
          className="text-text-primary/90 leading-relaxed tracking-wide overflow-hidden"
        >
          {blocks.map((block, index) =>
            isStreaming && tailFence && index === blocks.length - 1 ? (
              <StreamingFenceBlock
                key={index}
                block={block}
                language={tailFence.language}
                fontSize={fontSize}
              />
            ) : (
              <MarkdownBlock key={index} content={block} components={markdownComponents} />
            ),
          )}
        </div>
      )}
    </>
  )
}


export const MarkdownContentView = React.memo(MarkdownContentViewBase)
MarkdownContentView.displayName = 'MarkdownContentView'
