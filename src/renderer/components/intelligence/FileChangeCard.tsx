/**
 * 文件变更卡片
 * 用于展示 create_file / edit_file 等工具的 diff 预览
 * 采用「内容解析器 + 状态视觉工厂 + 子组件组合」三层架构：
 *  - 内容解析器：将工具参数与流式状态归一化为 oldContent/newContent/diffStats
 *  - 状态视觉工厂：根据运行/成功/错误/审批状态生成卡片样式与状态图标
 *  - 子组件拆分：头部、内容体、审批栏、错误信息各自独立
 */
import { useState, useEffect, useMemo, memo, type ReactNode } from 'react'
import { Check, X, ChevronDown, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@intelligence/providerTypes'
import { useToolDisplayState } from '@intelligence/display/toolResultRenderer'
import { streamingEditService } from '@intelligence/runtime/streamingEditor'
import { resolveStreamingEditFilePath } from '@intelligence/runtime/editPreviewStreamer'
import { useToolCardExpansion } from '@hooks'
import InlineDiffPreview, { getApproxLineDeltaStats, getDiffStats } from './InlineDiffPreview'
import { getFileName, joinPath } from '@shared/toolkit/pathHelper'
import { ExpandablePreviewContainer } from './ToolCallCard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { api } from '../../adapters/electronBridge'
import { toast } from '@components/foundation/NotificationProvider'

interface FileChangeCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
  onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
  messageId?: string
}

/** diff 统计结果 */
interface DiffStats {
  added: number
  removed: number
}

/** 判定路径是否为绝对路径 */
function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|[/])/.test(path)
}

/** 将相对路径解析为绝对路径 */
function resolveAbsolutePath(filePath: string, workspacePath: string): string {
  if (isAbsolutePath(filePath) || !workspacePath) return filePath
  return joinPath(workspacePath, filePath)
}

/** 从工具参数中提取文件路径 */
function extractFilePath(args: Record<string, unknown>, meta?: Record<string, unknown>): string {
  return ((args.path as string) || (meta?.filePath as string)) || ''
}

/** 解析旧内容来源：meta.oldContent > old_string > 流式占位 */
function resolveOldContent(
  meta: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
  isActive: boolean,
  toolName: string,
): string {
  if (meta?.oldContent !== undefined) return meta.oldContent as string
  if (isActive && args.old_string) return args.old_string as string
  // 流式部分编辑且无 old_string 时返回空，避免噪音
  if (isActive && !meta?.oldContent && !args.old_string && toolName === 'edit_file') return ''
  return ''
}

/** 解析新内容来源：流式内容 > meta.newContent > 参数候选 */
function resolveNewContent(
  meta: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
  streamingContent: string | null,
  isActive: boolean,
): string {
  if (streamingContent && isActive) return streamingContent
  if (meta?.newContent) return meta.newContent as string
  return ((args.content as string) ||
    (args.code as string) ||
    (args.new_string as string) ||
    (args.replacement as string) ||
    (args.source as string)) || ''
}

/** 计算 diff 统计，优先使用工具返回的精确值 */
function computeDiffStats(
  meta: Record<string, unknown> | undefined,
  oldContent: string,
  newContent: string,
  isActive: boolean,
): DiffStats {
  if (meta?.linesAdded !== undefined || meta?.linesRemoved !== undefined) {
    return {
      added: (meta.linesAdded as number) || 0,
      removed: (meta.linesRemoved as number) || 0,
    }
  }
  if (!newContent) return { added: 0, removed: 0 }
  if (isActive) return getApproxLineDeltaStats(oldContent, newContent)
  try {
    return getDiffStats(oldContent, newContent)
  } catch {
    return { added: 0, removed: 0 }
  }
}

/** 判定是否为新建文件 */
function detectNewFile(toolName: string, oldContent: string, newContent: string): boolean {
  if (['create_file', 'create_file_or_folder'].includes(toolName)) return true
  if (!oldContent && !!newContent && !['edit_file', 'replace_file_content', 'write_file'].includes(toolName)) {
    return true
  }
  return false
}

/** 卡片视觉配置 */
interface CardVisual {
  containerClass: string
  showSweep: boolean
}

/** 根据状态构建卡片视觉配置 */
function buildCardVisual(
  isAwaitingApproval: boolean | undefined,
  isError: boolean,
  isStreaming: boolean,
  isRunning: boolean,
): CardVisual {
  if (isAwaitingApproval) {
    return { containerClass: 'border-l-2 border-red-500 bg-red-500/5', showSweep: false }
  }
  if (isError) {
    return { containerClass: 'bg-red-500/5', showSweep: false }
  }
  if (isStreaming || isRunning) {
    return { containerClass: 'bg-accent/5', showSweep: true }
  }
  return { containerClass: 'hover:bg-text-primary/[0.02] transition-colors rounded-lg', showSweep: false }
}

/** 状态图标 */
function StatusIcon({ isStreaming, isRunning, isSuccess, isError }: {
  isStreaming: boolean
  isRunning: boolean
  isSuccess: boolean
  isError: boolean
}) {
  if (isStreaming || isRunning) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      </div>
    )
  }
  if (isSuccess) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-green-500" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
        <X className="w-2.5 h-2.5 text-red-500" />
      </div>
    )
  }
  return <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
}

/** diff 统计徽章 */
function DiffStatsBadge({ stats, isNewFile }: { stats: DiffStats; isNewFile: boolean }) {
  return (
    <span className="text-[11px] font-mono opacity-60 flex items-center gap-1.5 px-1.5 py-0.5 bg-text-primary/[0.05] rounded border border-border">
      {stats.added > 0 && <span className="text-green-400">+{stats.added}</span>}
      {stats.removed > 0 && <span className="text-red-400">-{stats.removed}</span>}
      {isNewFile && stats.added === 0 && <span className="text-blue-400">new</span>}
    </span>
  )
}

/** 大文件延迟提示 */
function LargeFileDeferred({ meta, onOpen }: {
  meta: Record<string, unknown> | undefined
  onOpen: () => void
}) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[12px] text-text-secondary">
      <div className="font-medium text-amber-400">
        Large file preview is deferred to keep the UI responsive.
      </div>
      <div className="mt-1 opacity-80">
        {typeof meta?.oldContentLength === 'number' || typeof meta?.newContentLength === 'number'
          ? `Size: ${meta?.oldContentLength || 0} -> ${meta?.newContentLength || 0} chars`
          : 'Open the file in the editor to inspect the full result.'}
      </div>
      <div className="mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="rounded-md border border-border bg-surface-hover px-2.5 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:border-accent hover:text-accent"
        >
          Open full file
        </button>
      </div>
    </div>
  )
}

/** 卡片头部 */
function CardHeader({
  isExpanded,
  onToggle,
  statusIcon,
  fileInfo,
  trailing,
}: {
  isExpanded: boolean
  onToggle: () => void
  statusIcon: ReactNode
  fileInfo: ReactNode
  trailing: ReactNode
}) {
  return (
    <div
      className="flex min-h-[32px] items-center gap-2 py-1.5 cursor-pointer select-none"
      onClick={onToggle}
    >
      <motion.div
        animate={{ rotate: isExpanded ? 90 : 0 }}
        transition={{ duration: 0.15 }}
        className="shrink-0 text-text-muted/85 hover:text-text-muted transition-colors"
      >
        <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
      </motion.div>

      <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
        {statusIcon}
      </div>

      <div className="flex-1 min-w-0 flex items-center justify-between relative z-10">
        {fileInfo}
        {trailing}
      </div>
    </div>
  )
}

/** 审批操作栏 */
function ApprovalBar({
  language,
  onApprove,
  onReject,
}: {
  language: string
  onApprove?: () => void
  onReject?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-red-500/10 bg-red-500/5">
      <span className="text-xs text-red-400/70 truncate">
        {t('toolAwaitingApproval', language as any)}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onReject}
          className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all active:scale-95"
        >
          {t('toolReject', language as any)}
        </button>
        <button
          onClick={onApprove}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95 hover:shadow-accent/40"
        >
          {t('toolApprove', language as any)}
        </button>
      </div>
    </div>
  )
}

/** 错误信息块 */
function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="px-3 pb-3 pl-9">
      <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
        <p className="text-[12px] text-red-300 font-mono break-all">{error}</p>
      </div>
    </div>
  )
}

/** 文件路径点击处理器工厂 */
function useFileOpenHandler(opts: {
  filePath: string
  workspacePath: string
  openFile: (path: string, content: string, oldContent?: string) => void
  setActiveFile: (path: string) => void
  onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
  isLargeWrite: boolean
  oldContent: string
  newContent: string
}) {
  return (e: React.MouseEvent) => {
    e.stopPropagation()
    const { filePath, workspacePath, openFile, setActiveFile, onOpenInEditor, isLargeWrite, oldContent, newContent } = opts
    if (isLargeWrite) {
      void (async () => {
        const absPath = resolveAbsolutePath(filePath, workspacePath)
        try {
          const content = await api.file.read(absPath)
          if (content !== null) {
            openFile(absPath, content)
            setActiveFile(absPath)
            return
          }
        } catch {
          // ignore
        }
        toast.error(`Failed to open file: ${getFileName(absPath)}`)
      })()
      return
    }
    if (onOpenInEditor && newContent) {
      onOpenInEditor(filePath, oldContent, newContent)
      return
    }
    const absPath = resolveAbsolutePath(filePath, workspacePath)
    api.file
      .read(absPath)
      .then((content) => {
        if (content !== null) {
          const diffUri = `diff://${absPath}`
          openFile(diffUri, newContent, oldContent)
          setActiveFile(diffUri)
        } else {
          toast.error(`Failed to open file: ${getFileName(absPath)}`)
        }
      })
      .catch(() => {
        toast.error(`Failed to open file: ${getFileName(absPath)}`)
      })
  }
}

function FileChangeCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
  onOpenInEditor,
}: FileChangeCardProps) {
  const { openFile, setActiveFile, workspacePath, language, expandToolCallsByDefault } = useStore(
    useShallow((s) => ({
      openFile: s.openFile,
      setActiveFile: s.setActiveFile,
      workspacePath: s.workspacePath,
      language: s.language,
      expandToolCallsByDefault: s.agentConfig.expandToolCallsByDefault ?? false,
    })),
  )
  const { args, isSuccess, isError, isRunning, isStreaming } = useToolDisplayState(toolCall)
  const isActive = isRunning || isStreaming
  const { isExpanded, animateContent, handleToggleExpanded } = useToolCardExpansion({
    defaultExpanded: expandToolCallsByDefault,
    isActive,
  })

  const meta = args._meta as Record<string, unknown> | undefined
  const filePath = extractFilePath(args, meta)
  const resolvedStreamingFilePath = useMemo(
    () => resolveStreamingEditFilePath(filePath, workspacePath) || '',
    [filePath, workspacePath],
  )
  const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true

  // 订阅流式编辑内容
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  useEffect(() => {
    if (!isRunning && !isStreaming) {
      setStreamingContent(null)
      return
    }
    const editState = streamingEditService.getEditByFilePath(resolvedStreamingFilePath)
    if (editState) setStreamingContent(editState.currentContent)
    const unsubscribe = streamingEditService.subscribeByFilePath(resolvedStreamingFilePath, (state) => {
      setStreamingContent(state?.currentContent ?? null)
    })
    return unsubscribe
  }, [resolvedStreamingFilePath, isRunning, isStreaming])

  const oldContent = useMemo(
    () => resolveOldContent(meta, args, isActive, toolCall.name),
    [meta, args, isActive, toolCall.name],
  )

  const newContent = useMemo(
    () => resolveNewContent(meta, args, streamingContent, isActive),
    [meta, args, streamingContent, isActive],
  )

  const openFullFile = useMemo(
    () => async () => {
      const absPath = resolveAbsolutePath(filePath, workspacePath ?? '')
      try {
        const content = await api.file.read(absPath)
        if (content !== null) {
          openFile(absPath, content)
          setActiveFile(absPath)
          return
        }
      } catch {
        // ignore
      }
      toast.error(`Failed to open file: ${getFileName(absPath)}`)
    },
    [filePath, workspacePath, openFile, setActiveFile],
  )

  const diffStats = useMemo(
    () => computeDiffStats(meta, oldContent, newContent, isActive),
    [meta, oldContent, newContent, isActive],
  )

  const isNewFile = detectNewFile(toolCall.name, oldContent, newContent)
  const visual = buildCardVisual(isAwaitingApproval, isError, isStreaming, isRunning)

  const handleFileClick = useFileOpenHandler({
    filePath,
    workspacePath: workspacePath ?? '',
    openFile,
    setActiveFile,
    onOpenInEditor,
    isLargeWrite,
    oldContent,
    newContent,
  })

  const statusIcon = (
    <StatusIcon
      isStreaming={isStreaming}
      isRunning={isRunning}
      isSuccess={isSuccess}
      isError={isError}
    />
  )

  const fileInfo = filePath ? (
    <div className="flex items-center gap-2 truncate">
      <span
        className={`text-[12px] truncate transition-colors ${
          isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
        }`}
      >
        {isNewFile ? 'Create ' : 'Update '}
      </span>
      <span
        className={`${isNewFile ? 'text-status-success' : 'text-text-primary'} ${
          isActive ? 'tool-text-shimmer text-[12px] font-medium' : 'font-medium text-[12px]'
        } hover:underline hover:text-accent cursor-pointer transition-colors break-all`}
        onClick={handleFileClick}
        title={filePath}
      >
        {getFileName(filePath)}
      </span>
    </div>
  ) : isActive ? (
    <span className="font-medium text-[12px] italic tool-text-shimmer">editing...</span>
  ) : (
    <span className="font-medium text-[12px] text-text-primary opacity-50">&lt;empty path&gt;</span>
  )

  const trailing = (
    <div className="flex items-center gap-2">
      {(isSuccess || newContent) && (
        <DiffStatsBadge stats={diffStats} isNewFile={isNewFile} />
      )}
      {isSuccess && onOpenInEditor && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (isLargeWrite) {
              void openFullFile()
              return
            }
            onOpenInEditor(filePath, oldContent, newContent)
          }}
          className="p-1 text-text-muted hover:text-accent hover:bg-surface-hover rounded-md transition-colors opacity-0 group-hover:opacity-100"
          title="Open in Editor"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )

  const contentBody = (
    <div className="pl-[26px] pr-3 pb-3 pt-0 relative">
      <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />
      <div className="relative z-10">
        <ExpandablePreviewContainer language={language}>
          <div className="relative min-h-[60px] p-2">
            {isLargeWrite && !isStreaming && !isRunning ? (
              <LargeFileDeferred meta={meta} onOpen={() => void openFullFile()} />
            ) : (
              <InlineDiffPreview
                oldContent={oldContent}
                newContent={newContent}
                filePath={filePath}
                isStreaming={isActive}
                maxLines={50}
              />
            )}
          </div>
        </ExpandablePreviewContainer>
      </div>
    </div>
  )

  return (
    <div className={`group my-0.5 relative ${visual.containerClass} overflow-hidden`}>
      {visual.showSweep && (
        <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
          <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent tool-card-sweep" />
        </div>
      )}

      <CardHeader
        isExpanded={isExpanded}
        onToggle={handleToggleExpanded}
        statusIcon={statusIcon}
        fileInfo={fileInfo}
        trailing={trailing}
      />

      {isExpanded && (newContent || isActive || isLargeWrite) && (
        animateContent ? (
          <AnimatePresence initial={false}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {contentBody}
            </motion.div>
          </AnimatePresence>
        ) : (
          contentBody
        )
      )}

      {toolCall.error && isExpanded && <ErrorBlock error={toolCall.error} />}

      {isAwaitingApproval && (
        <ApprovalBar language={language} onApprove={onApprove} onReject={onReject} />
      )}
    </div>
  )
}

export default memo(FileChangeCard)
