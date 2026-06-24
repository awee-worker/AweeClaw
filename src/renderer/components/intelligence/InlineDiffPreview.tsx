/**
 * 内联差异预览
 * 采用「差异引擎 + 调度器 + 行渲染器 + 折叠策略」四层架构：
 *  - 差异引擎：纯函数模块，负责流式/完整 diff 计算与统计
 *  - 调度器：rAF/timeout 双模式调度，避免阻塞主线程
 *  - 行渲染器：单行 diff 视觉，支持语法高亮
 *  - 折叠策略：根据变更密度选择「全量/上下文/截断」三种展示模式
 */
import React, { useMemo, useState, useEffect, useRef } from 'react'
import { CodeHighlight } from './CodeHighlight'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import * as Diff from 'diff'
import { CodeSkeleton } from '../ui/ProgressIndicator'
import { logger } from '@shared/toolkit/LogEngine'
import { getExtension } from '@shared/toolkit/pathHelper'

/** diff 行类型 */
export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

/** 展示行：普通行或省略占位 */
type DisplayDiffLine = DiffLine | { type: 'ellipsis'; count: number }

interface InlineDiffPreviewProps {
  oldContent: string
  newContent: string
  filePath: string
  isStreaming?: boolean
  maxLines?: number
}

/** 调度帧类型 */
type ScheduledFrame =
  | { kind: 'raf'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> }

/** diff 计算的最大文件尺寸（字符数） */
const MAX_FILE_SIZE_FOR_DIFF = 50000

/** 调度下一帧，优先 rAF，回退 timeout */
function scheduleNextFrame(callback: () => void): ScheduledFrame {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return { kind: 'raf', id: window.requestAnimationFrame(callback) }
  }
  return { kind: 'timeout', id: setTimeout(callback, 16) }
}

/** 取消已调度帧 */
function cancelScheduledFrame(frame: ScheduledFrame): void {
  if (frame.kind === 'raf') {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame.id)
      return
    }
    clearTimeout(frame.id)
    return
  }
  clearTimeout(frame.id)
}

/** 文件扩展名到语言标识的映射表 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', vue: 'vue', svelte: 'svelte',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
  xml: 'xml', graphql: 'graphql', prisma: 'prisma',
}

/** 根据文件路径推断语言标识 */
function resolveLanguageFromPath(path: string): string {
  const ext = getExtension(path)
  return EXTENSION_LANGUAGE_MAP[ext || ''] || 'text'
}

/** 流式 diff：将新内容按行标记为新增 */
function buildStreamingDiff(newContent: string, maxLines = 100): DiffLine[] {
  if (!newContent) return []
  const lines = newContent.split('\n').slice(0, maxLines)
  return lines.map((content, idx) => ({
    type: 'add' as const,
    content: content.slice(0, 500),
    newLineNumber: idx + 1,
  }))
}

/** 完整 diff：基于行级 diff 计算带行号的变更序列 */
function buildFullDiff(oldContent: string, newContent: string): DiffLine[] {
  const changes = Diff.diffLines(oldContent, newContent)
  const result: DiffLine[] = []
  let oldLineNum = 1
  let newLineNum = 1

  for (const change of changes) {
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()

    for (const line of lines) {
      if (change.added) {
        result.push({ type: 'add', content: line, newLineNumber: newLineNum++ })
      } else if (change.removed) {
        result.push({ type: 'remove', content: line, oldLineNumber: oldLineNum++ })
      } else {
        result.push({
          type: 'unchanged',
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        })
      }
    }
  }
  return result
}

/** 统计内容行数（按换行符计数） */
export function countContentLines(content: string): number {
  if (!content) return 0
  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++
  }
  return count
}

/** 流式阶段的近似行差统计 */
export function getApproxLineDeltaStats(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = countContentLines(oldContent)
  const newLines = countContentLines(newContent)
  return {
    added: Math.max(0, newLines - oldLines),
    removed: Math.max(0, oldLines - newLines),
  }
}

/** 异步 diff 调度器 Hook */
function useAsyncDiff(
  oldContent: string,
  newContent: string,
  isStreaming: boolean,
  enabled: boolean,
  maxLines: number,
) {
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingFrameRef = useRef<ScheduledFrame | null>(null)

  useEffect(() => {
    if (!enabled) {
      setDiffLines(null)
      return
    }

    if (!oldContent && !newContent) {
      setDiffLines([])
      setIsLoading(false)
      setError(null)
      return
    }

    if (pendingFrameRef.current) {
      cancelScheduledFrame(pendingFrameRef.current)
      pendingFrameRef.current = null
    }

    // 流式模式：rAF 调度轻量 diff
    if (isStreaming) {
      setIsLoading(false)
      setError(null)
      pendingFrameRef.current = scheduleNextFrame(() => {
        pendingFrameRef.current = null
        setDiffLines(buildStreamingDiff(newContent, maxLines))
      })
      return () => {
        if (pendingFrameRef.current) {
          cancelScheduledFrame(pendingFrameRef.current)
          pendingFrameRef.current = null
        }
      }
    }

    // 完整模式：超大文件直接报错
    if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
      setError('File too large for inline diff. Open in editor to view changes.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    const timerId = setTimeout(() => {
      try {
        if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
          throw new Error('File too large')
        }
        setDiffLines(buildFullDiff(oldContent, newContent))
      } catch (err) {
        logger.ui.error('Diff calculation failed:', err)
        setError('Diff calculation too complex or timed out.')
      } finally {
        setIsLoading(false)
      }
    }, 50)

    return () => {
      clearTimeout(timerId)
      if (pendingFrameRef.current) {
        cancelScheduledFrame(pendingFrameRef.current)
        pendingFrameRef.current = null
      }
    }
  }, [oldContent, newContent, isStreaming, enabled, maxLines])

  return { diffLines, isLoading, error }
}

/** 行视觉配置 */
interface LineVisual {
  bgClass: string
  symbolClass: string
  symbol: string
}

/** 根据行类型构建视觉配置 */
function buildLineVisual(type: DiffLine['type']): LineVisual {
  switch (type) {
    case 'add':
      return {
        bgClass: 'bg-green-500/15 border-l-2 border-green-500/50',
        symbolClass: 'text-green-500 dark:text-green-400',
        symbol: '+',
      }
    case 'remove':
      return {
        bgClass: 'bg-red-500/15 border-l-2 border-red-500/50',
        symbolClass: 'text-red-500 dark:text-red-400',
        symbol: '-',
      }
    default:
      return {
        bgClass: 'border-l-2 border-transparent',
        symbolClass: 'text-text-muted/75',
        symbol: ' ',
      }
  }
}

/** 单行 diff 渲染 */
const DiffLineItem = React.memo(
  ({ line, language, isDark }: { line: DiffLine; language: string; isDark: boolean }) => {
    const visual = buildLineVisual(line.type)
    const lineNum = line.type === 'remove' ? line.oldLineNumber : line.newLineNumber

    return (
      <div className={`flex ${visual.bgClass} hover:brightness-95 dark:hover:brightness-110 transition-all`}>
        <span className="w-5 shrink-0 text-right pr-1 text-text-muted/85 select-none text-[11px] mt-[1px]">
          {lineNum || ''}
        </span>
        <span className={`w-2.5 shrink-0 text-center select-none font-bold mt-[1px] ${visual.symbolClass}`}>
          {visual.symbol}
        </span>
        <div className="flex-1 overflow-hidden">
          {line.content.length > 500 ? (
            <div className="whitespace-pre text-text-muted truncate">
              {line.content.slice(0, 500)}... (line too long)
            </div>
          ) : (
            <CodeHighlight
              code={line.content || ' '}
              language={language}
              isDark={isDark}
              fontSize={12}
              inline
            />
          )}
        </div>
      </div>
    )
  },
)
DiffLineItem.displayName = 'DiffLineItem'

/** 折叠策略类型 */
type CollapseStrategy = 'full' | 'context' | 'truncate'

/** 根据变更密度选择折叠策略 */
function selectCollapseStrategy(diffLines: DiffLine[], maxLines: number, isStreaming: boolean): CollapseStrategy {
  if (diffLines.length <= maxLines) return 'full'
  if (isStreaming) return 'truncate'
  const changedCount = diffLines.filter((l) => l.type !== 'unchanged').length
  return changedCount > maxLines * 0.8 ? 'truncate' : 'context'
}

/** 上下文折叠：保留变更行附近 N 行 */
function collapseWithContext(diffLines: DiffLine[], maxLines: number, contextSize = 3): DisplayDiffLine[] {
  const changedIndices = new Set<number>()
  diffLines.forEach((line, idx) => {
    if (line.type === 'add' || line.type === 'remove') {
      for (let i = Math.max(0, idx - contextSize); i <= Math.min(diffLines.length - 1, idx + contextSize); i++) {
        changedIndices.add(i)
      }
    }
  })

  const result: DisplayDiffLine[] = []
  let lastIdx = -1
  const sortedIndices = Array.from(changedIndices).sort((a, b) => a - b)

  for (const idx of sortedIndices) {
    if (lastIdx >= 0 && idx - lastIdx > 1) {
      result.push({ type: 'ellipsis', count: idx - lastIdx - 1 })
    }
    result.push(diffLines[idx])
    lastIdx = idx
    if (result.length >= maxLines) {
      result.push({ type: 'ellipsis', count: diffLines.length - idx - 1 })
      return result
    }
  }
  if (lastIdx < diffLines.length - 1) {
    result.push({ type: 'ellipsis', count: diffLines.length - lastIdx - 1 })
  }
  return result
}

/** 截断折叠：直接截取前 N 行 */
function collapseByTruncate(diffLines: DiffLine[], maxLines: number): DisplayDiffLine[] {
  const truncated = diffLines.slice(0, maxLines)
  if (diffLines.length > maxLines) {
    return [...truncated, { type: 'ellipsis', count: diffLines.length - maxLines }]
  }
  return truncated
}

/** 省略行占位 */
function EllipsisRow({ count, isStreaming, language }: { count: number; isStreaming: boolean; language: string }) {
  return (
    <div className="text-text-muted/85 text-center py-1 text-[11px] bg-surface-active/30">
      ... {count} {isStreaming ? t('diff.more', language as any) : t('diff.unchanged', language as any)}{' '}
      {t('diff.lines', language as any)} ...
    </div>
  )
}

/** 流式状态提示条 */
function StreamingBanner({ language }: { language: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/20 text-accent text-[11px]">
      <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      <span>{t('diff.streamingChanges', language as any)}</span>
    </div>
  )
}

/** 空状态提示 */
function EmptyState({ isStreaming, language }: { isStreaming: boolean; language: string }) {
  return (
    <div className="text-[11px] text-text-muted italic px-2 py-1">
      {isStreaming ? t('diff.waitingContent', language as any) : t('diff.noChanges', language as any)}
    </div>
  )
}

/** 错误状态提示 */
function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 text-xs text-text-muted bg-white/5 italic text-center">{message}</div>
  )
}

export const DiffSkeleton = CodeSkeleton

export default function InlineDiffPreview({
  oldContent,
  newContent,
  filePath,
  isStreaming = false,
  maxLines = 100,
}: InlineDiffPreviewProps) {
  const language = useMemo(() => resolveLanguageFromPath(filePath), [filePath])
  const currentTheme = useStore((s) => s.currentTheme)
  const appLanguage = useStore((s) => s.language)
  const isLight = currentTheme.endsWith('-light')
  const isDark = !isLight

  const { diffLines, isLoading, error } = useAsyncDiff(oldContent, newContent, isStreaming, true, maxLines)

  const displayLines = useMemo<DisplayDiffLine[]>(() => {
    if (!diffLines) return []
    const strategy = selectCollapseStrategy(diffLines, maxLines, isStreaming)
    switch (strategy) {
      case 'full':
        return diffLines
      case 'truncate':
        return collapseByTruncate(diffLines, maxLines)
      case 'context':
        return collapseWithContext(diffLines, maxLines)
    }
  }, [diffLines, maxLines, isStreaming])

  if (isLoading && !isStreaming) return <DiffSkeleton />
  if (error) return <ErrorState message={error} />
  if (!diffLines || displayLines.length === 0) {
    return <EmptyState isStreaming={isStreaming} language={appLanguage} />
  }

  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {isStreaming && <StreamingBanner language={appLanguage} />}
      {displayLines.map((line, idx) => {
        if ('count' in line && line.type === 'ellipsis') {
          return (
            <EllipsisRow
              key={`ellipsis-${idx}`}
              count={line.count}
              isStreaming={isStreaming}
              language={appLanguage}
            />
          )
        }
        return (
          <DiffLineItem
            key={`${line.type}-${idx}-${line.oldLineNumber || line.newLineNumber}`}
            line={line}
            language={language}
            isDark={isDark}
          />
        )
      })}
    </div>
  )
}

/** 完整 diff 统计：返回新增/删除行数 */
export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number } {
  if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
    return { added: 0, removed: 0 }
  }
  try {
    const changes = Diff.diffLines(oldContent, newContent)
    let added = 0
    let removed = 0
    for (const change of changes) {
      const lineCount = change.value
        .split('\n')
        .filter((line) => line !== '' || change.value === '\n').length
      if (change.added) added += lineCount
      else if (change.removed) removed += lineCount
    }
    return { added, removed }
  } catch {
    return { added: 0, removed: 0 }
  }
}
