/**
 * Agent 状态栏组件
 * 精致的内嵌式设计 - 与输入框融为一体
 *
 * 职责：
 * 1. 显示流式状态和等待审批状态
 * 2. 显示文件变更列表（复用 useChangesReview）
 * 3. 提供 Accept/Reject 操作
 */

import { useState, useCallback, useMemo, memo } from 'react'
import {
  X,
  Check,
  ExternalLink,
  Square,
  ChevronDown,
  FileCode,
  FilePlus,
  FileX,
  CheckCheck,
  XCircle,
  FolderOpen,
  Eye,
  Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFileName, getDirname } from '@shared/utils/pathUtils'
import type { StreamDetail } from '@/renderer/agent/types/thread'
import type { PendingChange } from '@/renderer/agent/types'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

const TOOL_LABEL_KEYS: Record<string, string> = {
    read_file: 'tool.label.read_file',
    read_multiple_files: 'tool.label.read_multiple_files',
    list_directory: 'tool.label.list_directory',
    search_files: 'tool.label.search_files',
    codebase_search: 'tool.label.codebase_search',
    edit_file: 'tool.label.edit_file',
    write_file: 'tool.label.write_file',
    create_file: 'tool.label.create_file',
    create_file_or_folder: 'tool.label.create_file_or_folder',
    delete_file_or_folder: 'tool.label.delete_file_or_folder',
    run_command: 'tool.label.run_command',
    get_lint_errors: 'tool.label.get_lint_errors',
    find_references: 'tool.label.find_references',
    go_to_definition: 'tool.label.go_to_definition',
    get_hover_info: 'tool.label.get_hover_info',
    get_document_symbols: 'tool.label.get_document_symbols',
    web_search: 'tool.label.web_search',
    read_url: 'tool.label.read_url',
    ask_user: 'tool.label.ask_user',
    remember: 'tool.label.remember',
    knowledge_search: 'tool.label.knowledge_search',
    uiux_search: 'tool.label.uiux_search',
    uiux_recommend: 'tool.label.uiux_recommend',
    apply_skill: 'tool.label.apply_skill',
    todo_write: 'tool.label.todo_write',
}

interface AgentStatusBarProps {
  pendingChanges: PendingChange[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  streamDetail?: StreamDetail
  currentToolName?: string
  currentTaskLabel?: string
  iterationIndex?: number
  onStop?: () => void
  onReviewFile?: (filePath: string) => void
  onAcceptFile?: (filePath: string) => void
  onRejectFile?: (filePath: string) => void
  onUndoAll?: () => void
  onKeepAll?: () => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onViewAllChanges?: () => void
}

function AgentStatusBar({
  pendingChanges,
  isStreaming,
  isAwaitingApproval,
  streamDetail,
  currentToolName,
  currentTaskLabel,
  iterationIndex,
  onStop,
  onReviewFile,
  onAcceptFile,
  onRejectFile,
  onUndoAll,
  onKeepAll,
  onApproveTool,
  onRejectTool,
  onViewAllChanges,
}: AgentStatusBarProps) {
  const expandAgentBlocksByDefault = useStore(s => s.agentConfig.expandAgentBlocksByDefault ?? false)
  const language = useStore(s => s.language)
  const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const stats = useMemo(() => {
    let linesAdded = 0
    let linesRemoved = 0
    pendingChanges.forEach(change => {
      linesAdded += change.linesAdded || 0
      linesRemoved += change.linesRemoved || 0
    })
    return {
      total: pendingChanges.length,
      linesAdded,
      linesRemoved,
    }
  }, [pendingChanges])

  const groupedChanges = useMemo(() => {
    const groups = new Map<string, PendingChange[]>()
    for (const change of pendingChanges) {
      const dir = getDirname(change.relativePath || change.filePath) || '.'
      if (!groups.has(dir)) {
        groups.set(dir, [])
      }
      groups.get(dir)!.push(change)
    }
    return groups
  }, [pendingChanges])

  const hasChanges = pendingChanges.length > 0
  const showBar = isStreaming || isAwaitingApproval || hasChanges

  const toolDisplayName = currentToolName
    ? (TOOL_LABEL_KEYS[currentToolName] ? t(TOOL_LABEL_KEYS[currentToolName] as any, language as any) : currentToolName)
    : null

  const statusLabel = useMemo(() => {
    if (!isStreaming) return null
    const iterSuffix = iterationIndex && iterationIndex > 1 ? ` #${iterationIndex}` : ''
    if (currentTaskLabel && toolDisplayName) {
      return `${toolDisplayName} · ${currentTaskLabel}${iterSuffix}`
    }
    if (currentTaskLabel) return `${currentTaskLabel}${iterSuffix}`
    if (toolDisplayName) return `${toolDisplayName}${iterSuffix}`
    switch (streamDetail) {
      case 'reasoning':
        return t('statusBar.thinking', language as any)
      case 'responding':
        return t('statusBar.responding', language as any)
      case 'tool_executing':
      case 'tool_awaiting':
        return t('statusBar.processing', language as any)
      default:
        return t('statusBar.thinking', language as any)
    }
  }, [isStreaming, currentTaskLabel, toolDisplayName, streamDetail, language, iterationIndex])

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) {
        next.delete(dir)
      } else {
        next.add(dir)
      }
      return next
    })
  }, [])

  const handleAccept = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onAcceptFile?.(filePath)
  }, [onAcceptFile])

  const handleReject = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onRejectFile?.(filePath)
  }, [onRejectFile])

  const handleReview = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onReviewFile?.(filePath)
  }, [onReviewFile])

  if (!showBar) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
    >
      <div className="rounded-xl border border-border/50 bg-surface overflow-hidden shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] transition-all">
        {(isStreaming || isAwaitingApproval) && (
          <div className={`flex items-center justify-between px-4 py-2 ${hasChanges ? 'border-b border-border/50' : ''}`}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {isStreaming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
                  <span className="text-[12px] font-medium tool-text-shimmer truncate">
                    {statusLabel}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse flex-shrink-0" />
                  <span className="text-[12px] font-medium text-amber-400/80 truncate">
                    {t('statusBar.waitingApproval', language as any)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {isStreaming && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-text-muted/90 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all border border-transparent hover:border-red-500/20"
                >
                  <Square className="w-2 h-2 fill-current" />
                  <span>{t('statusBar.stop', language as any)}</span>
                </button>
              )}

              {!isStreaming && isAwaitingApproval && (onApproveTool || onRejectTool) && (
                <div className="flex items-center gap-1">
                  {onRejectTool && (
                    <button
                      onClick={onRejectTool}
                      className="px-2 py-1 text-[11px] font-medium text-text-muted/85 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                    >
                      {t('statusBar.cancel', language as any)}
                    </button>
                  )}
                  {onApproveTool && (
                    <button
                      onClick={onApproveTool}
                      className="px-2.5 py-1 text-[11px] font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all"
                    >
                      {t('statusBar.approve', language as any)}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {hasChanges && (
          <>
            <div
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: isExpanded ? 0 : -90 }}
                  transition={{ duration: 0.15 }}
                  className="text-text-muted/85"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.div>

                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-text-muted/85">
                    {stats.total} {stats.total > 1 ? t('statusBar.filesChanged', language as any) : t('statusBar.fileChanged', language as any)}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span className="text-green-400/80">+{stats.linesAdded}</span>
                    <span className="text-red-400/80">-{stats.linesRemoved}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                {pendingChanges.length >= 2 && onViewAllChanges && (
                  <button
                    onClick={onViewAllChanges}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-muted hover:text-accent hover:bg-accent/10 rounded-lg transition-all"
                    title={t('statusBar.reviewAll', language as any)}
                  >
                    <Eye className="w-3 h-3" />
                    <span>{t('statusBar.review', language as any)}</span>
                  </button>
                )}
                <button
                  onClick={() => onUndoAll?.()}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  title={t('statusBar.rejectAll', language as any)}
                >
                  <XCircle className="w-3 h-3" />
                  <span>{t('statusBar.reject', language as any)}</span>
                </button>
                <button
                  onClick={() => onKeepAll?.()}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-all"
                  title={t('statusBar.acceptAll', language as any)}
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>{t('statusBar.accept', language as any)}</span>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border/50 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {Array.from(groupedChanges.entries()).map(([dir, dirChanges]) => (
                      <div key={dir}>
                        {groupedChanges.size > 1 && (
                          <div
                            className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-text-muted/85 hover:text-text-muted cursor-pointer hover:bg-surface-hover transition-colors"
                            onClick={() => toggleDir(dir)}
                          >
                            {expandedDirs.has(dir) || groupedChanges.size === 1 ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3 -rotate-90" />
                            )}
                            <FolderOpen className="w-3 h-3 text-yellow-500/50" />
                            <span className="font-medium">{dir || '.'}</span>
                            <span className="text-[10px]">({dirChanges.length})</span>
                          </div>
                        )}

                        {(expandedDirs.has(dir) || groupedChanges.size === 1) && (
                          <div className={groupedChanges.size > 1 ? 'ml-4' : ''}>
                            {dirChanges.map(change => (
                              <FileChangeRow
                                key={change.filePath}
                                change={change}
                                onAccept={handleAccept}
                                onReject={handleReject}
                                onReview={handleReview}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  )
}

interface FileChangeRowProps {
  change: PendingChange
  onAccept: (e: React.MouseEvent, filePath: string) => void
  onReject: (e: React.MouseEvent, filePath: string) => void
  onReview: (e: React.MouseEvent, filePath: string) => void
}

function FileChangeRow({ change, onAccept, onReject, onReview }: FileChangeRowProps) {
  const displayPath = change.relativePath || change.filePath
  const fileName = getFileName(displayPath)
  const language = useStore(s => s.language)

  const TypeIcon = change.changeType === 'create' ? FilePlus
    : change.changeType === 'delete' ? FileX
      : FileCode

  const typeColor = change.changeType === 'create' ? 'text-green-400/60'
    : change.changeType === 'delete' ? 'text-red-400/60'
      : 'text-text-muted/90'

  return (
    <div
      className="flex items-center justify-between px-4 py-2 hover:bg-surface-hover cursor-pointer transition-colors group"
      onClick={(e) => onReview(e, change.filePath)}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <TypeIcon className={`w-3.5 h-3.5 ${typeColor} shrink-0 group-hover:text-accent/60 transition-colors`} />
        <div className="min-w-0 flex-1">
          <span
            className="text-[12px] text-text-muted/90 group-hover:text-text-secondary truncate transition-colors"
            title={displayPath}
          >
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono opacity-50 group-hover:opacity-80 transition-opacity">
          {change.linesAdded !== undefined && change.linesAdded > 0 && (
            <span className="text-green-400">+{change.linesAdded}</span>
          )}
          {change.linesRemoved !== undefined && change.linesRemoved > 0 && (
            <span className="text-red-400">-{change.linesRemoved}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => onReview(e, change.filePath)}
          className="p-1 text-text-muted/85 hover:text-accent hover:bg-accent/10 rounded transition-colors"
          title={t('statusBar.viewDiff', language as any)}
        >
          <ExternalLink className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => onReject(e, change.filePath)}
          className="p-1 text-text-muted/85 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          title={t('statusBar.discard', language as any)}
        >
          <X className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => onAccept(e, change.filePath)}
          className="p-1 text-green-400/50 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
          title={t('statusBar.accept', language as any)}
        >
          <Check className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

export default memo(AgentStatusBar)
