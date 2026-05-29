/**
 * 聊天消息组件
 * Linear / Apple 风格：完全左对齐，用户消息右对齐气泡
 * 新设计：极致排版，支持 HintOverlay
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Copy, Check, Edit2, RotateCcw, ChevronDown, X, Wrench, FileText, Code, Folder, Link2, Clock, MoreHorizontal, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { SyntaxHighlighter, patchSyntaxStyle } from '@utils/syntaxHighlighter'
import { playNotificationSound } from '@utils/notificationSound'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { themeManager } from '../../config/themeDefinition'
import { motion, AnimatePresence } from 'framer-motion'
import { BRAND } from '@shared/brand'
import {
  ChatMessage as ChatMessageType,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  getMessageImages,
  getMessageFiles,
  AssistantPart,
  isTextPart,
  isToolCallPart,
  isReasoningPart,
  isSearchPart,
  isSystemAlertPart,
  isLintCheckPart,
  isContextSnapshotPart,
  isSourcesPart,
  isFormPart,
  isMultiAgentWorkflowPart,
  ToolCall,
} from '@intelligence/providerTypes'
import type { LLMStreamSource } from '@shared/protocols/modelGateway'
import { LintCheckCard } from './LintCheckCard'
import ToolCallGroup, { renderToolCallCard } from './ToolCallGroup'
import { InteractiveCard } from './InteractiveCard'
import { FormCard } from './FormCard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { HintOverlay } from '../ui/HintOverlay'
import { OverlayDialog } from '../ui/OverlayDialog'
import { LazyImage } from '../foundation/DeferredImage'
import { useSmoothStream } from '@hooks/useSmoothStream'
import { SystemAlert, parseSystemAlert } from './SystemAlert'
import { CompressionDigestCard } from './CompressionDigestCard'
import { t } from '../../i18n'
import { api } from '../../adapters/electronBridge'
import { openUrlInBrowser } from '@utils/browserLauncher'
import { toFullPath, getFileName } from '@shared/toolkit/pathHelper'
import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'
import type { ToolStreamingPreview } from '@protocols'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  onDeleteRound?: (messageId: string) => void
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (messageId: string) => void
}

interface RenderPartProps {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}

const EMPTY_PREVIEWS: Record<string, ToolStreamingPreview> = {}
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]
const ACTIVE_STREAM_PHASES = new Set(['streaming', 'tool_running', 'tool_pending'])
const STREAMING_TAIL_LENGTH = 40

// 代码块组件 - 更加精致的玻璃质感
const CodeBlock = React.memo(({ language, children, fontSize }: { language: string | undefined; children: React.ReactNode; fontSize: number }) => {
  const [copied, setCopied] = useState(false)
  const currentTheme = useStore(s => s.currentTheme)
  const theme = themeManager.getThemeById(currentTheme)
  const syntaxStyle = useMemo(
    () => patchSyntaxStyle(theme?.type === 'light' ? vs : vscDarkPlus),
    [theme?.type]
  )

  // Flatten text from children
  const codeText = React.useMemo(() => {
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

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border bg-background-tertiary shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border/50">
        <span className="text-[11px] text-text-muted font-bold font-mono uppercase tracking-widest opacity-70">
          {language || 'text'}
        </span>
        <HintOverlay content="Copy Code">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </HintOverlay>
      </div>
      <div className="relative">
        <SyntaxHighlighter
          style={syntaxStyle}
          language={language}
          PreTag="div"
          className="!bg-transparent !p-4 !m-0 custom-scrollbar leading-relaxed font-mono"
          customStyle={{ backgroundColor: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
          wrapLines
          wrapLongLines
        >
          {codeText}
        </SyntaxHighlighter>
      </div>
    </div>
  )
})

CodeBlock.displayName = 'CodeBlock'

const cleanStreamingContent = (text: string): string => {
  if (!text) return ''
  return stripToolCallLeaks(text)
}

const renderStreamingTailText = (value: string, key: string) => {
  if (!value) return value

  const tailLength = Math.min(STREAMING_TAIL_LENGTH, value.length)
  if (tailLength <= 0) return value

  const stableText = value.slice(0, -tailLength)
  const animatedTail = value.slice(-tailLength)

  return (
    <React.Fragment key={key}>
      {stableText}
      {animatedTail.split('').map((char, i) => {
        const charIndex = value.length - tailLength + i
        return (
          <span key={`${key}-${charIndex}`} className="inline-stream-char">
            {char}
          </span>
        )
      })}
    </React.Fragment>
  )
}

const decorateStreamingChild = (child: React.ReactNode, path: string): { changed: boolean; node: React.ReactNode } => {
  if (typeof child === 'string') {
    return { changed: true, node: renderStreamingTailText(child, path) }
  }

  if (typeof child === 'number') {
    return { changed: true, node: renderStreamingTailText(String(child), path) }
  }

  if (!React.isValidElement(child)) {
    return { changed: false, node: child }
  }

  const childProps = child.props as { children?: React.ReactNode } | null
  if (!childProps || childProps.children == null) {
    return { changed: false, node: child }
  }

  const decoratedChildren = decorateStreamingChildren(childProps.children, path)
  if (decoratedChildren === childProps.children) {
    return { changed: false, node: child }
  }

  return {
    changed: true,
    node: React.cloneElement(child, undefined, decoratedChildren),
  }
}

const decorateStreamingChildren = (children: React.ReactNode, basePath = 'tail'): React.ReactNode => {
  const childArray = React.Children.toArray(children)
  for (let index = childArray.length - 1; index >= 0; index -= 1) {
    const currentChild = childArray[index]
    const decorated = decorateStreamingChild(currentChild, `${basePath}-${index}`)
    if (!decorated.changed) continue
    if (decorated.node == null || typeof decorated.node === 'boolean') continue

    const nextChildren = [...childArray]
    nextChildren[index] = decorated.node
    return nextChildren
  }

  return children
}


// ThinkingBlock 组件 - 扁平化折叠样式
interface ThinkingBlockProps {
  content: string
  startTime?: number
  isStreaming: boolean
  fontSize: number
}

// 统一上下文面板 — 单个折叠块，无边框扁平设计
interface MessageMetaGroupProps {
  autoSkills?: any[]
  manualSkills?: any[]
  searchContent?: string
  isSearchStreaming?: boolean
}

const MessageMetaGroup = React.memo(({ autoSkills, manualSkills, searchContent, isSearchStreaming }: MessageMetaGroupProps) => {
  // Hooks 必须在所有条件返回之前调用（React 规则）
  const { openFile, setActiveFile, workspacePath, expandAgentBlocksByDefault, language } = useStore(useShallow(s => ({
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    workspacePath: s.workspacePath,
    expandAgentBlocksByDefault: s.agentConfig.expandAgentBlocksByDefault ?? false,
    language: s.language,
  })))
  const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)

  const hasAutoSkills = autoSkills && autoSkills.length > 0
  const hasManualSkills = manualSkills && manualSkills.length > 0
  const hasSearch = searchContent !== undefined || isSearchStreaming
  const hasSkills = hasAutoSkills || hasManualSkills
  const isStreaming = isSearchStreaming

  if (!hasSkills && !hasSearch) return null

  const handleOpenSkill = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    if (!workspacePath) return
    const filePath = `${workspacePath}/${BRAND.dirName}/skills/${skillId}/SKILL.md`.replace(/\//g, '\\')
    const content = await api.file.read(filePath)
    if (content !== null) {
      openFile(filePath, content)
      setActiveFile(filePath)
    }
  }

  // 折叠时的摘要
  const allSkills = [...(autoSkills || []), ...(manualSkills || [])]
  const skillNames = allSkills.map((s: any) => s.skillId).join(', ')

  return (
    <div className="overflow-hidden w-full my-0.5 animate-fade-in relative z-10">
      {/* 标题行 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 py-1.5 cursor-pointer select-none group rounded-md hover:bg-text-primary/[0.03] transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/85 group-hover:text-text-muted transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>

        <div className="shrink-0 w-4 h-4 flex items-center justify-center">
          {isStreaming ? (
            <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            </div>
          ) : (
            <Wrench className="w-3 h-3 text-text-muted/85" />
          )}
        </div>

        <span className={`text-[12px] ${isStreaming ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
          {language === 'zh' ? '上下文' : 'Context'}
        </span>

        {/* 折叠时显示 skill 名称列表 */}
        {!isExpanded && skillNames && (
          <span className="text-[12px] text-text-muted/85 truncate ml-0.5">
            — {skillNames}
          </span>
        )}
      </div>

      {/* 展开内容 — 每行一个类别摘要 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-1.5 pl-[38px] pr-3 space-y-0.5">
              {/* Skill Referenced */}
              {hasSkills && (
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-text-muted/75 shrink-0">{language === 'zh' ? '引用技能' : 'Skill Referenced'}</span>
                  {allSkills.map((item: any, i: number) => (
                    <React.Fragment key={item.skillId || i}>
                      {i > 0 && <span className="text-text-muted/85">,</span>}
                      <button
                        onClick={(e) => handleOpenSkill(e, item.skillId)}
                        className="font-mono text-text-muted/75 hover:text-accent transition-colors focus:outline-none"
                      >
                        {item.skillId}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* File Referenced */}
              {hasSearch && (
                <div className="text-[12px]">
                  {searchContent ? (
                    <div className="flex items-start gap-1.5">
                      <span className="text-text-muted/75 shrink-0">{language === 'zh' ? '引用文件' : 'File Referenced'}</span>
                      <div className="text-text-muted/85 leading-relaxed max-h-32 overflow-auto custom-scrollbar whitespace-pre-wrap">
                        {searchContent}
                      </div>
                    </div>
                  ) : (
                    <span className="text-text-muted/65 italic">{language === 'zh' ? '正在搜索文件...' : 'Searching files...'}</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
MessageMetaGroup.displayName = 'MessageMetaGroup'

const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize }: ThinkingBlockProps) => {
  const language = useStore(s => s.language)
  const [isExpanded, setIsExpanded] = useState(false)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = React.useRef<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')
  const prevIsStreamingRef = React.useRef(isStreaming)
  const userToggledRef = React.useRef(false)

  useEffect(() => {
    if (isStreaming && !prevIsStreamingRef.current) {
      setIsExpanded(true)
      userToggledRef.current = false
    } else if (!isStreaming && prevIsStreamingRef.current) {
      if (!userToggledRef.current) {
        const timer = setTimeout(() => setIsExpanded(false), 600)
        return () => clearTimeout(timer)
      }
    }
    prevIsStreamingRef.current = isStreaming
  }, [isStreaming])

  const handleToggle = useCallback(() => {
    userToggledRef.current = true
    setIsExpanded(prev => !prev)
  }, [])

  useEffect(() => {
    if (!startTime || !isStreaming) return
    const timer = setInterval(() => {
      const current = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(current)
      lastElapsed.current = current
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime, isStreaming])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isExpanded) return
    const checkScroll = () => {
      const hasTop = el.scrollTop > 0
      const hasBottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1
      setShadowClass([hasTop ? 'shadow-top' : '', hasBottom ? 'shadow-bottom' : ''].filter(Boolean).join(' '))
    }
    checkScroll()
    el.addEventListener('scroll', checkScroll)
    return () => el.removeEventListener('scroll', checkScroll)
  }, [isExpanded, content])

  const { displayedContent: fluidContent } = useSmoothStream(content, isStreaming, 1.5)

  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [fluidContent, isStreaming, isExpanded])

  const durationText = !isStreaming
    ? (lastElapsed.current > 0 ? t('thought.for', language, { sec: lastElapsed.current }) : t('thought.done', language))
    : t('thinking.for', language, { sec: elapsed })

  const previewText = useMemo(() => {
    if (!content || content.length === 0) return ''
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || ''
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine
  }, [content])

  return (
    <div className="my-2.5 group/think overflow-hidden">
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 py-1.5 text-text-muted/85 hover:text-text-muted rounded-md hover:bg-text-primary/[0.03] transition-colors select-none"
      >
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <span className="thinking-indicator-icon" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-accent/25" />
          )}
        </div>
        <span className={`text-[12px] ${isStreaming ? 'text-accent/80 font-medium' : ''}`}>
          {durationText}
        </span>
        {!isExpanded && previewText && (
          <span className="text-[11px] text-text-muted/50 truncate max-w-[60%] ml-1">
            {previewText}
          </span>
        )}
        {!isExpanded && isStreaming && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-breathe ml-0.5" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="relative ml-[14px] mt-0.5 mb-1">
              <div className={`absolute left-0 top-0 bottom-0 w-[2px] rounded-full ${isStreaming ? 'thinking-border-glow' : 'bg-accent/20'}`} />
              {isStreaming && (
                <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full thinking-sweep-line" />
              )}
              <div className={`relative rounded-xl ${isStreaming ? 'bg-accent/[0.03]' : 'bg-surface/30'} border ${isStreaming ? 'border-accent/[0.08]' : 'border-border/30'} overflow-hidden`}>
                <div className={`scroll-shadow-container ${shadowClass}`}>
                  <div
                    ref={scrollRef}
                    className="max-h-[300px] overflow-y-auto scrollbar-none pl-5 pr-3 py-3"
                  >
                    {content ? (
                      <div
                        style={{ fontSize: `${fontSize - 1}px` }}
                        className={`text-text-muted/80 leading-relaxed whitespace-pre-wrap font-sans ${isStreaming ? 'animate-block-reveal' : ''}`}
                      >
                        {isStreaming ? renderStreamingTailText(fluidContent, 'think-tail') : fluidContent}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-text-muted/80 italic text-xs py-1">
                        <span className="text-shimmer">{language === 'zh' ? '正在分析...' : 'Analyzing...'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
ThinkingBlock.displayName = 'ThinkingBlock'

const URL_PATTERN = /(?<!\()(https?:\/\/[^\s<>\[\]"'`\u3000-\u303F\uFF00-\uFFEF]*[^\s<>\[\]"'`\u3000-\u303F\uFF00-\uFFEF.,;:!?)}\]])/g

function preprocessUrls(text: string): string {
  const codeBlockRanges: [number, number][] = []
  const codeBlockRegex = /```[\s\S]*?```/g
  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlockRanges.push([match.index, match.index + match[0].length])
  }
  const inlineCodeRegex = /`[^`]+`/g
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    codeBlockRanges.push([match.index, match.index + match[0].length])
  }
  const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
  while ((match = mdLinkRegex.exec(text)) !== null) {
    codeBlockRanges.push([match.index, match.index + match[0].length])
  }

  const isInCodeBlock = (idx: number) => codeBlockRanges.some(([s, e]) => idx >= s && idx < e)

  URL_PATTERN.lastIndex = 0
  const results: string[] = []
  let lastIndex = 0

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const url = match[0]
    const matchStart = match.index
    const matchEnd = matchStart + url.length

    if (isInCodeBlock(matchStart)) {
      continue
    }

    if (matchStart > 0 && text[matchStart - 1] === '(') {
      continue
    }

    results.push(text.slice(lastIndex, matchStart))
    results.push(`[${url}](${url})`)
    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    results.push(text.slice(lastIndex))
  }

  return results.length > 0 ? results.join('') : text
}

function convertLineBreaks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      result.push(line)
      continue
    }

    if (inCodeBlock) {
      result.push(line)
      continue
    }

    if (line.trim() === '') {
      result.push(line)
      continue
    }

    if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line) || /^#{1,6}\s/.test(line) || /^>\s/.test(line) || /^---/.test(line) || /^\|/.test(line)) {
      result.push(line)
      continue
    }

    result.push(line + '  ')
  }

  return result.join('\n')
}

// Markdown 渲染组件
const MarkdownContent = React.memo(({ content: rawContent, fontSize, isStreaming, preserveLineBreaks }: { content: string; fontSize: number; isStreaming?: boolean; preserveLineBreaks?: boolean }) => {
  const content = typeof rawContent === 'string' ? rawContent : String(rawContent ?? '')
  const language = useStore(s => s.language)

  const cleanedContent = React.useMemo(() => {
    let result = isStreaming ? cleanStreamingContent(content) : content
    result = preprocessUrls(result)
    if (preserveLineBreaks) {
      result = convertLineBreaks(result)
    }
    return result
  }, [content, isStreaming, preserveLineBreaks])

  // 检测系统警告
  const systemAlert = React.useMemo(() => {
    if (!isStreaming) {
      return parseSystemAlert(cleanedContent, language)
    }
    return null
  }, [cleanedContent, isStreaming])

  // 如果检测到系统警告，移除原始文本中的警告部分
  const contentWithoutAlert = React.useMemo(() => {
    if (systemAlert) {
      // 移除 ⚠️ 和 💡 部分
      return cleanedContent.replace(/⚠️\s*.+?(?:\n💡\s*.+)?$/s, '').trim()
    }
    return cleanedContent
  }, [cleanedContent, systemAlert])

  // 平滑流式插入
  const { displayedContent: smoothContent } = useSmoothStream(contentWithoutAlert || '', !!isStreaming, 1.5)
  const enableBlockReveal = !!isStreaming

  const { workspacePath, openFile, setActiveFile } = useStore(useShallow(s => ({ workspacePath: s.workspacePath, openFile: s.openFile, setActiveFile: s.setActiveFile })))

  const handleOpenFile = React.useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const resolvedPath = toFullPath(filePath, workspacePath)

    try {
      const content = await api.file.read(resolvedPath)
      if (content !== null) {
        openFile(resolvedPath, content)
        setActiveFile(resolvedPath)
      }
    } catch (err) {
      console.warn('Failed to open file from markdown:', err)
    }
  }, [workspacePath, openFile, setActiveFile])

  const renderStreamingChildren = React.useCallback((children: React.ReactNode) => {
    if (!isStreaming) return children
    return decorateStreamingChildren(children)
  }, [isStreaming])

  const markdownComponents = React.useMemo(() => ({
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
          <CodeBlock language={match?.[1]} fontSize={fontSize}>{children}</CodeBlock>
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
  }), [enableBlockReveal, fontSize, handleOpenFile, isStreaming, renderStreamingChildren])

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
})
MarkdownContent.displayName = 'MarkdownContent'

function getSourceHref(source: LLMStreamSource): string | null {
  return source.sourceType === 'url' && source.url ? source.url : null
}

function getSourceLabel(source: LLMStreamSource): string {
  return source.title || source.filename || source.url || source.id
}

const SourcesBlock = React.memo(({ sources }: { sources: LLMStreamSource[] }) => {
  if (sources.length === 0) return null

  return (
    <div className="my-3 rounded-xl border border-border/60 bg-surface/30 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-muted">
        <Link2 className="h-3.5 w-3.5" />
        Sources
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          const href = getSourceHref(source)
          const label = getSourceLabel(source)
          const meta = source.sourceType === 'document'
            ? source.mediaType || source.filename
            : source.url

          return (
            <div
              key={source.id || `${source.sourceType}:${label}`}
              className="rounded-lg border border-border/50 bg-background/35 px-2.5 py-2"
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm font-medium text-accent transition-colors hover:text-accent-hover hover:underline"
                  onClick={(e) => {
                    e.preventDefault()
                    openUrlInBrowser(href)
                  }}
                >
                  {label}
                </a>
              ) : (
                <div className="text-sm font-medium text-text-primary">{label}</div>
              )}
              {meta && (
                <div className="mt-0.5 break-all text-[12px] text-text-muted">
                  {meta}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

SourcesBlock.displayName = 'SourcesBlock'

// 渲染单个 Part
const RenderPart = React.memo(({
  part,
  index,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  fontSize,
  isStreaming,
  messageId,
}: RenderPartProps) => {
  if (isTextPart(part)) {
    const textStr = typeof part.content === 'string' ? part.content : String(part.content ?? '')
    if (!textStr.trim()) return null
    return (
      <MarkdownContent
        key={`text-${index}`}
        content={textStr}
        fontSize={fontSize}
        isStreaming={isStreaming}
      />
    )
  }

  if (isReasoningPart(part)) {
    if (!part.content?.trim() && !part.isStreaming) return null
    return (
      <ThinkingBlock
        key={`reasoning-${index}`}
        content={part.content}
        startTime={part.startTime}
        isStreaming={!!part.isStreaming}
        fontSize={fontSize}
      />
    )
  }

  // Search results are static for now
  if (isSearchPart(part)) {
    return null
  }

  if (isSystemAlertPart(part)) {
    return (
      <SystemAlert
        type={part.alertType}
        title={part.title}
        message={part.message}
        suggestion={part.suggestion}
        compact={part.compact}
        action={part.action}
        onAction={(action) => {
          if (action.actionType === 'continue') {
            window.dispatchEvent(new CustomEvent('chat-send-message', {
              detail: { content: '继续执行未完成的任务', messageId }
            }))
          }
        }}
      />
    )
  }

  // Lint check results
  if (isLintCheckPart(part)) {
    return <LintCheckCard part={part} />
  }

  if (isContextSnapshotPart(part)) {
    return (
      <CompressionDigestCard
        part={part}
        variant={part.presentation === 'source_marker' ? 'timeline' : 'card'}
      />
    )
  }

  // Tool calls: 统一由 renderToolCallCard 处理
  if (isSourcesPart(part)) {
    return <SourcesBlock sources={part.sources} />
  }

  if (isFormPart(part)) {
    return (
      <div className="my-2 w-full">
        <FormCard
          content={part.form}
          onSubmit={(values) => {
            const summary = Object.entries(values)
              .filter(([, v]) => v !== '' && v !== undefined && v !== false)
              .map(([k, v]) => {
                const field = part.form.fields.find(f => f.id === k)
                return field ? `${field.label}: ${v}` : `${k}: ${v}`
              })
              .join('\n')
            window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: summary } }))
          }}
        />
      </div>
    )
  }

  if (isMultiAgentWorkflowPart(part)) {
    return null
  }

  if (isToolCallPart(part)) {
    const tc = part.toolCall
    return (
      <div className="my-3">
        {renderToolCallCard(tc, {
          pendingToolId,
          onApproveTool,
          onRejectTool,
          onOpenDiff,
          messageId,
        })}
      </div>
    )
  }

  return null
})

RenderPart.displayName = 'RenderPart'

const StreamingPhaseIndicator = React.memo(({
  mode,
  waitPhase,
  streamStartTime,
  streamDetail,
  retryAttempt,
  retryDelay,
  hasReasoningBlock,
}: {
  mode: 'waiting' | 'inline'
  waitPhase?: string
  streamStartTime?: number
  streamDetail?: string
  retryAttempt?: number
  retryDelay?: number
  hasReasoningBlock?: boolean
}) => {
  const language = useStore(s => s.language)
  const [elapsed, setElapsed] = useState(0)
  const [retryCountdown, setRetryCountdown] = useState(0)

  useEffect(() => {
    if (!streamStartTime) return
    const update = () => setElapsed(Math.floor((Date.now() - streamStartTime) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [streamStartTime])

  useEffect(() => {
    if (!retryDelay || !retryAttempt || retryAttempt <= 0) {
      setRetryCountdown(0)
      return
    }
    const endTime = Date.now() + retryDelay
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000))
      setRetryCountdown(remaining)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [retryDelay, retryAttempt])

  const isRetrying = retryAttempt && retryAttempt > 0
  const prevRetryAttemptRef = useRef(0)

  useEffect(() => {
    if (retryAttempt && retryAttempt > prevRetryAttemptRef.current) {
      playNotificationSound('attention')
    }
    prevRetryAttemptRef.current = retryAttempt ?? 0
  }, [retryAttempt])

  const label = useMemo(() => {
    if (isRetrying) {
      const base = t('waitPhase.retrying', language as any, { attempt: retryAttempt })
      return retryCountdown > 0 ? `${base} ${retryCountdown}s` : base
    }
    if (mode === 'waiting') {
      switch (waitPhase) {
        case 'connecting': return t('waitPhase.connecting', language as any)
        case 'building_context': return t('waitPhase.building_context', language as any)
        case 'compressing': return t('waitPhase.compressing', language as any)
        case 'waiting_model': return t('waitPhase.waiting_model', language as any)
        default: return t('statusBar.thinking', language as any)
      }
    }
    switch (streamDetail) {
      case 'reasoning': return hasReasoningBlock ? null : t('statusBar.thinking', language as any)
      case 'tool_executing': return t('statusBar.processing', language as any)
      case 'tool_awaiting': return t('statusBar.processing', language as any)
      default: return null
    }
  }, [mode, waitPhase, streamDetail, language, retryAttempt, isRetrying, hasReasoningBlock, retryCountdown])

  if (!label) return null

  const elapsedText = elapsed > 0
    ? ` ${t('waitPhase.elapsed', language as any, { sec: elapsed })}`
    : ''

  if (mode === 'waiting') {
    return (
      <div className="flex items-center gap-2.5 py-2 px-1">
        <div className="relative flex items-center justify-center w-5 h-5">
          <span className={`absolute w-3 h-3 rounded-full ${isRetrying ? 'bg-amber-500/20 animate-breathe' : 'bg-accent/20 animate-breathe'}`} />
          <span className={`w-1.5 h-1.5 rounded-full ${isRetrying ? 'bg-amber-500/80' : 'bg-accent/80'}`} />
        </div>
        <span className={`text-[12px] font-medium ${isRetrying ? 'text-amber-400/90' : 'text-text-muted/80'}`}>
          {label}{elapsedText}
        </span>
        <div className="flex items-center gap-0.5 ml-0.5">
          <span className={`wait-dot w-0.5 h-0.5 rounded-full ${isRetrying ? 'bg-amber-500/60' : 'bg-accent/60'}`} />
          <span className={`wait-dot w-0.5 h-0.5 rounded-full ${isRetrying ? 'bg-amber-500/60' : 'bg-accent/60'}`} />
          <span className={`wait-dot w-0.5 h-0.5 rounded-full ${isRetrying ? 'bg-amber-500/60' : 'bg-accent/60'}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-surface/60 border border-border/50">
      <span className={`w-1.5 h-1.5 rounded-full ${isRetrying ? 'bg-amber-400' : 'bg-accent/70'} animate-breathe`} />
      <span className={`text-[11px] font-medium ${isRetrying ? 'text-amber-400/80' : 'text-text-muted/70'}`}>
        {label}
      </span>
    </div>
  )
})
StreamingPhaseIndicator.displayName = 'StreamingPhaseIndicator'

const AssistantMessageContent = React.memo(({
  parts,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  fontSize,
  isStreaming,
  messageId,
}: {
  parts: AssistantPart[]
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}) => {
  // Memoize 分组逻辑
  const groups = React.useMemo(() => {
    const result: Array<
      | { type: 'part'; part: AssistantPart; index: number }
      | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number }
    > = []

    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        if (currentToolCalls.length > 0) {
          result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
          currentToolCalls = []
        }
        result.push({ type: 'part', part, index })
      }
    })

    if (currentToolCalls.length > 0) {
      result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
    }

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
        if (group.type === 'part') {
          return (
            <div key={`wrap-part-${group.index}`} className="w-full">
              <RenderPart
                part={group.part}
                index={group.index}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onRejectTool={onRejectTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
                messageId={messageId}
              />
            </div>
          )
        }

        if (group.toolCalls.length === 1) {
          return (
            <div key={`wrap-tool-${group.startIndex}`} className="w-full">
              <RenderPart
                part={parts[group.startIndex]}
                index={group.startIndex}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onRejectTool={onRejectTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
                messageId={messageId}
              />
            </div>
          )
        }

        return (
          <div key={`wrap-group-${group.startIndex}`} className="w-full">
            <ToolCallGroup
              toolCalls={group.toolCalls}
              pendingToolId={pendingToolId}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
              onOpenDiff={onOpenDiff}
              messageId={messageId}
            />
          </div>
        )
      })}
    </>
  )
})
AssistantMessageContent.displayName = 'AssistantMessageContent'

const ChatMessage = React.memo(({
  message: messageProp,
  onEdit,
  onRegenerate,
  onRestore,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
  isWorkspaceEditor,
  onDeleteRound,
  selectionMode,
  isSelected,
  onToggleSelect,
}: ChatMessageProps) => {
  const message = messageProp

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showMsgMenu, setShowMsgMenu] = useState(false)
  const [msgMenuPos, setMsgMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const { editorConfig, language } = useStore(useShallow(s => ({ editorConfig: s.editorConfig, language: s.language })))
  const fontSize = editorConfig.chatFontSize ?? editorConfig.fontSize

  useEffect(() => {
    if (!showMsgMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-msg-menu]')) {
        setShowMsgMenu(false)
        setMsgMenuPos(null)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showMsgMenu])

  if (!isUserMessage(message) && !isAssistantMessage(message)) {
    return null
  }

  const isUser = isUserMessage(message)
  const textContent = getMessageText(message.content)
  const images = isUser ? getMessageImages(message.content) : []
  const files = isUser ? getMessageFiles(message.content) : []

  const handleStartEdit = () => {
    setEditContent(textContent)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tt = {
    copy: language === 'zh' ? '复制内容' : 'Copy Content',
    edit: language === 'zh' ? '编辑消息' : 'Edit Message',
    restore: language === 'zh' ? '恢复到此检查点' : 'Restore checkpoint',
    save: language === 'zh' ? '保存并重发' : 'Save & Resend',
    cancel: language === 'zh' ? '取消' : 'Cancel',
  }

  const { isStreaming, previewMap, liveParts, liveInteractive, waitPhase, streamStartTime, retryAttempt, retryDelay, streamDetail } = useAgentStore(useShallow(state => {
    if (!isAssistantMessage(message)) {
      return {
        isStreaming: false,
        previewMap: EMPTY_PREVIEWS,
        liveParts: undefined,
        liveInteractive: undefined,
        waitPhase: undefined,
        streamStartTime: undefined,
        retryAttempt: undefined,
        retryDelay: undefined,
        streamDetail: undefined,
      }
    }

    const threadId = state.currentThreadId
    const threadStreamState = threadId ? state.threads[threadId]?.streamState : undefined
    const liveMessage = threadId
      ? state.threads[threadId]?.messages.find(msg => msg.id === message.id && msg.role === 'assistant')
      : undefined
    const isActiveAssistant =
      Boolean(message.isStreaming) &&
      !!threadId &&
      threadStreamState?.assistantId === message.id &&
      ACTIVE_STREAM_PHASES.has(threadStreamState?.phase ?? 'idle')

    return {
      isStreaming: isActiveAssistant,
      liveParts: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.parts : undefined,
      liveInteractive: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.interactive : undefined,
      previewMap: isActiveAssistant
        ? state.threads[threadId!]?.toolStreamingPreviews || EMPTY_PREVIEWS
        : EMPTY_PREVIEWS,
      waitPhase: isActiveAssistant ? threadStreamState?.waitPhase : undefined,
      streamStartTime: isActiveAssistant ? threadStreamState?.streamStartTime : undefined,
      retryAttempt: isActiveAssistant ? threadStreamState?.retryAttempt : undefined,
      retryDelay: isActiveAssistant ? threadStreamState?.retryDelay : undefined,
      streamDetail: isActiveAssistant ? threadStreamState?.streamDetail : undefined,
    }
  }))

  const assistantParts = isAssistantMessage(message) ? (liveParts ?? message.parts) : undefined
  const assistantInteractive = isAssistantMessage(message) ? (liveInteractive ?? message.interactive) : undefined

  const previewToolCalls = React.useMemo(() => {
    if (!isAssistantMessage(message)) return []

    const persistedIds = new Set((message.toolCalls || []).map(tc => tc.id))

    return Object.entries(previewMap)
      .filter(([id, preview]) => preview?.isStreaming && !persistedIds.has(id))
      .sort(([, left], [, right]) => (left.lastUpdateTime || 0) - (right.lastUpdateTime || 0))
      .map(([id, preview]) => ({
        id,
        name: preview.name || '...',
        arguments: preview.partialArgs || {},
        status: 'pending' as const,
      }))
  }, [message, previewMap])

  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
      ${selectionMode && isSelected ? 'bg-accent/5' : ''}
    `}>
      {selectionMode ? (
        <div className="w-full px-4 flex items-start gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(message.id) }}
            className={`flex-shrink-0 mt-2 w-[18px] h-[18px] rounded flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? 'bg-accent border-accent'
                : 'bg-transparent border-2 border-border/60 hover:border-accent/50'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </button>
          <div className={`flex-1 min-w-0 px-3.5 py-2.5 rounded-2xl border ${isUser ? 'bg-accent/8 border-accent/15' : 'bg-surface/80 border-border/40'}`}>
            {isUser ? (
              <div className="text-[14px] leading-relaxed text-text-primary/90">
                <MarkdownContent content={textContent} fontSize={fontSize} preserveLineBreaks />
              </div>
            ) : (
              <div className="prose-custom w-full max-w-none text-[15px] leading-relaxed text-text-primary/90">
                {assistantParts && assistantParts.length > 0 && (
                  <AssistantMessageContent
                    parts={assistantParts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={message.isStreaming}
                    messageId={message.id}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="w-full px-4 flex flex-col gap-1">

        {/* User Layout */}
        {isUser && (
          <div className="w-full flex flex-col items-end gap-1.5">
            {/* Bubble / Editing */}
            <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 w-full">
              {isEditing ? (
                <div className="w-full relative group/edit">
                  <div className="absolute inset-0 -m-1 rounded-[20px] bg-accent/5 opacity-0 group-focus-within/edit:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  <div className="relative bg-surface border border-accent/30 rounded-[18px] shadow-lg overflow-hidden animate-scale-in origin-right transition-all duration-200 group-focus-within/edit:border-accent group-focus-within/edit:ring-1 group-focus-within/edit:ring-accent/50">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSaveEdit()
                        }
                        if (e.key === 'Escape') {
                          setIsEditing(false)
                        }
                      }}
                      className="w-full bg-transparent border-none outline-none px-4 py-3 text-text-primary resize-none focus:ring-0 focus:outline-none transition-all custom-scrollbar font-mono text-sm leading-relaxed placeholder:text-text-muted/75"
                      rows={Math.max(2, Math.min(15, editContent.split('\n').length))}
                      autoFocus
                      style={{ fontSize: `${fontSize}px` }}
                      placeholder="Type your message..."
                    />
                    <div className="flex items-center justify-between px-2 py-1.5 bg-black/5 border-t border-black/5">
                      <span className="text-[11px] text-text-muted/85 ml-2 font-medium">
                        Esc to cancel • Enter to save
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setIsEditing(false)}
                          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
                          title={tt.cancel}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="p-1.5 rounded-lg text-accent hover:text-white hover:bg-accent transition-all shadow-sm"
                          title={tt.save}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative bg-surface text-text-primary/95 px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
                  {/* Context Items */}
                  {message.contextItems && message.contextItems.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2 -mt-1 pt-1 justify-end">
                      {message.contextItems.map((item: any, i: number) => {
                        const getContextStyle = (type: string) => {
                          switch (type) {
                            case 'File': return { bg: 'bg-text-primary/[0.04]', text: 'text-text-secondary', border: 'border-transparent', Icon: FileText }
                            case 'CodeSelection': return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-transparent', Icon: Code }
                            case 'Folder': return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-transparent', Icon: Folder }
                            case 'Skill': return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', Icon: Wrench }
                            default: return { bg: 'bg-text-primary/[0.04]', text: 'text-text-muted', border: 'border-transparent', Icon: FileText }
                          }
                        }
                        const style = getContextStyle(item.type)
                        const label = (() => {
                          switch (item.type) {
                            case 'File':
                            case 'Folder': {
                              const uri = item.uri || ''
                              return getFileName(uri) || uri
                            }
                            case 'CodeSelection': {
                              const uri = item.uri || ''
                              const range = item.range as [number, number] | undefined
                              const name = getFileName(uri) || uri
                              return range ? `${name}:${range[0]}-${range[1]}` : name
                            }
                            case 'Skill': {
                              return `@${item.skillId || 'skill'}`
                            }
                            default: return 'Context'
                          }
                        })()
                        const IconComponent = style.Icon

                        return (
                          <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${style.bg} ${style.text} text-[11px] font-medium rounded-md border ${style.border} select-none opacity-80 hover:opacity-100 transition-opacity`}>
                            <IconComponent className="w-3 h-3 opacity-70" />
                            <span className="max-w-[150px] truncate">{label}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Images */}
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 justify-end">
                      {images.map((img, i) => {
                        const imgSrc = `data:${img.source.media_type};base64,${img.source.data}`
                        return (
                          <div
                            key={`img-${img.source.media_type}-${i}`}
                            onClick={() => setPreviewImage(imgSrc)}
                            className="rounded-lg overflow-hidden border border-text-inverted/10 shadow-md h-28 max-w-[200px] group/img relative cursor-zoom-in hover:opacity-90 transition-opacity"
                          >
                            <LazyImage
                              src={imgSrc}
                              alt="Upload"
                              className="h-full w-auto object-cover"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* File Attachments */}
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 justify-end">
                      {files.map((file, i) => {
                        const ext = file.name.split('.').pop()?.toLowerCase() || ''
                        return (
                          <div
                            key={`file-${file.name}-${i}`}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-text-inverted/10 bg-surface/30 max-w-[220px]"
                          >
                            <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-[11px] font-bold text-accent uppercase">{ext || '?'}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-text-primary truncate">{file.name}</p>
                              <p className="text-[11px] text-text-muted">{file.media_type}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <OverlayDialog isOpen={!!previewImage} onClose={() => setPreviewImage(null)} size="full" noPadding showCloseButton={false}>
                    <div
                      className="w-full h-full flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
                      onClick={() => setPreviewImage(null)}
                    >
                      {previewImage && (
                        <img
                          src={previewImage}
                          alt="Preview"
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        />
                      )}
                    </div>
                  </OverlayDialog>

                  <div className="text-[14px] leading-relaxed">
                    <MarkdownContent content={textContent} fontSize={fontSize} preserveLineBreaks />
                  </div>
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-0.5 mt-1 mr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                  <HintOverlay content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </HintOverlay>
                  {onEdit && (
                    <HintOverlay content={tt.edit}>
                      <button onClick={handleStartEdit} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </HintOverlay>
                  )}
                  {isWorkspaceEditor && hasCheckpoint && onRestore && (
                    <HintOverlay content={tt.restore}>
                      <button onClick={() => onRestore(message.id)} className="p-1 rounded-md text-text-muted hover:text-amber-400 hover:bg-surface-hover transition-all">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </HintOverlay>
                  )}
                  {onDeleteRound && (
                    <div data-msg-menu={message.id}>
                      <HintOverlay content={language === 'zh' ? '更多' : 'More'}>
                        <button
                          ref={menuBtnRef}
                          onClick={() => {
                            if (showMsgMenu) {
                              setShowMsgMenu(false)
                              setMsgMenuPos(null)
                            } else {
                              if (menuBtnRef.current) {
                                const rect = menuBtnRef.current.getBoundingClientRect()
                                setMsgMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                              }
                              setShowMsgMenu(true)
                            }
                          }}
                          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
                        >
                          <MoreHorizontal className="w-3 h-3" />
                        </button>
                      </HintOverlay>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assistant Layout */}
        {!isUser && (
          <div className="w-full min-w-0 flex flex-col gap-2">
            <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
              {/* System Context Widget at the top of the content — hidden per user preference */}
              {/* {isAssistantMessage(message) && (message.contextItems?.some((item: any) => item.type === 'Skill') || assistantParts?.some(isSearchPart)) && (
                <MessageMetaGroup
                  autoSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && item.auto)}
                  manualSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && !item.auto)}
                  searchContent={assistantParts?.find(isSearchPart)?.content || undefined}
                  isSearchStreaming={(assistantParts?.find(isSearchPart) as any)?.isStreaming}
                />
              )} */}
              <div className="prose-custom w-full max-w-none">
                {assistantParts && assistantParts.length > 0 && (
                  <AssistantMessageContent
                    parts={assistantParts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={message.isStreaming}
                    messageId={message.id}
                  />
                )}
                {isStreaming && assistantParts && assistantParts.length > 0 && (
                  <StreamingPhaseIndicator mode="inline" streamDetail={streamDetail} retryAttempt={retryAttempt} retryDelay={retryDelay} hasReasoningBlock={assistantParts.some(isReasoningPart)} />
                )}
                  {isStreaming && (!assistantParts || assistantParts.length === 0) && previewToolCalls.length === 0 && (
                  <StreamingPhaseIndicator mode="waiting" waitPhase={waitPhase} streamStartTime={streamStartTime} streamDetail={streamDetail} retryAttempt={retryAttempt} retryDelay={retryDelay} />
                )}
                {previewToolCalls.length > 0 && (
                  <ToolCallGroup
                    toolCalls={previewToolCalls}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    messageId={message.id}
                  />
                )}
              </div>

              {assistantInteractive && !message.isStreaming && (
                <div className="mt-2 w-full">
                  <InteractiveCard
                    content={assistantInteractive}
                    onSelect={(selectedIds, customText) => {
                      const selectedLabels = assistantInteractive.options
                        .filter(opt => selectedIds.includes(opt.id))
                        .map(opt => opt.label)
                      const response = customText || selectedLabels.join(', ')
                      window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds } }))
                      window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
                    }}
                    disabled={!!assistantInteractive.selectedIds?.length}
                  />
                </div>
              )}
            </div>

            {!message.isStreaming && (
              <div className="flex items-center gap-1 pl-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                <HintOverlay content={tt.copy}>
                  <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </HintOverlay>
                {onRegenerate && (
                  <HintOverlay content={language === 'zh' ? '重新生成' : 'Regenerate'}>
                    <button
                      onClick={() => onRegenerate(message.id)}
                      className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </HintOverlay>
                )}
                {(() => {
                  const toolCalls = isAssistantMessage(message) ? message.toolCalls : undefined
                  const lastEnd = toolCalls?.reduce((max, tc) => Math.max(max, tc.endTime ?? 0), 0) ?? 0
                  const totalMs = lastEnd > 0 ? lastEnd - message.timestamp : 0
                  if (totalMs <= 0) return null
                  const totalSec = totalMs / 1000
                  const display = totalSec < 10 ? totalSec.toFixed(1) : Math.round(totalSec).toString()
                  return (
                    <HintOverlay content={language === 'zh' ? `总耗时 ${display}s` : `${display}s total`}>
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-text-muted/60 tabular-nums">
                        <Clock className="w-3 h-3" />
                        {display}s
                      </span>
                    </HintOverlay>
                  )
                })()}
                {onDeleteRound && (
                  <div data-msg-menu={message.id}>
                    <HintOverlay content={language === 'zh' ? '更多' : 'More'}>
                      <button
                        ref={menuBtnRef}
                        onClick={() => {
                          if (showMsgMenu) {
                            setShowMsgMenu(false)
                            setMsgMenuPos(null)
                          } else {
                            if (menuBtnRef.current) {
                              const rect = menuBtnRef.current.getBoundingClientRect()
                              setMsgMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                            }
                            setShowMsgMenu(true)
                          }
                        }}
                        className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </HintOverlay>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      {showMsgMenu && msgMenuPos && onDeleteRound && (
        <div
          style={{ position: 'fixed', top: msgMenuPos.top, right: msgMenuPos.right, zIndex: 9999 }}
          className="w-32 bg-surface border border-border/60 rounded-lg shadow-xl py-1 animate-fade-in"
          data-msg-menu={message.id}
        >
          <button
            onClick={() => {
              setShowMsgMenu(false)
              setMsgMenuPos(null)
              onDeleteRound(message.id)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {language === 'zh' ? '删除' : 'Delete'}
          </button>
        </div>
      )}
      </div>
      )}
    </div>
  )
})



ChatMessage.displayName = 'ChatMessage'

export default ChatMessage
