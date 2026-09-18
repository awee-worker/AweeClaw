/**
 * Agent 状态栏组件
 * 采用「状态分段 + 视觉配置 + 子组件组合」架构：
 *  - 状态分段：将流式/审批/变更三种状态分段渲染，职责清晰
 *  - 视觉配置：通过 STATUS_VISUAL 集中管理状态视觉
 *  - 子组件：StatusHeader、ApprovalList、ChangesSummary、FileChangeRow 拆分
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
  Shield,
  Zap,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFileName, getDirname } from '@shared/toolkit/pathHelper'
import type { StreamDetail } from '@intelligence/types/dialogThreadModel'
import type { PendingChange } from '@intelligence/providerTypes'
import type { ToolCall } from '@shared/protocols/modelGateway'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

/** 工具名到国际化键的映射表 */
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
  companion_control: 'tool.label.companion_control',
}

/** 文件变更类型到图标/颜色的视觉配置 */
const CHANGE_TYPE_VISUAL = {
  create: { Icon: FilePlus, color: 'text-green-400/60' },
  delete: { Icon: FileX, color: 'text-red-400/60' },
  modify: { Icon: FileCode, color: 'text-text-muted/90' },
} as const

interface AgentStatusBarProps {
  pendingChanges: PendingChange[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  streamDetail?: StreamDetail
  currentToolName?: string
  currentToolCall?: ToolCall
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
  onApproveAllTools?: () => void
  onRejectAllTools?: () => void
  pendingApprovalCount?: number
  pendingApprovalToolCalls?: ToolCall[]
  onViewAllChanges?: () => void
  activeScenarioId?: string
  securityPolicyActive?: boolean
}

/** 工具调用参数中可能表示路径/命令/查询/URL 的字段名 */
const TOOL_ARG_KEYS = {
  path: ['file_path', 'path', 'filePath'],
  command: ['command'],
  query: ['query', 'search_query', 'pattern'],
  url: ['url'],
} as const

/** 从工具参数中提取首个非空字段值 */
function pickFirstArg(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/** 截断字符串到指定长度 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** 构建工具调用的可读描述 */
function buildToolDescription(tc: ToolCall, language: string): string {
  const name = tc.name
  const args = (tc.arguments || {}) as Record<string, unknown>
  const label = TOOL_LABEL_KEYS[name] ? t(TOOL_LABEL_KEYS[name] as any, language as any) : name

  const filePath = pickFirstArg(args, TOOL_ARG_KEYS.path)
  if (filePath) return `${label}: ${getFileName(filePath)}`

  const command = pickFirstArg(args, TOOL_ARG_KEYS.command)
  if (command) return `${label}: ${truncate(command, 60)}`

  const url = pickFirstArg(args, TOOL_ARG_KEYS.url)
  if (url) return `${label}: ${truncate(url, 60)}`

  const query = pickFirstArg(args, TOOL_ARG_KEYS.query)
  if (query) return `${label}: "${truncate(query, 40)}"`

  return label
}

/** 根据流式状态推导展示文案 */
function resolveStreamLabel(
  streamDetail: StreamDetail | undefined,
  language: string,
): string {
  switch (streamDetail) {
    case 'reasoning':
      return t('statusBar.thinking', language as any)
    case 'responding':
      return t('statusBar.responding', language as any)
    case 'tool_executing':
    case 'tool_awaiting':
      return t('statusBar.processing', language as any)
    default:
      // streamDetail 尚未产生（含 undefined）：请求已发出、首包未到，
      // 模型还没有任何产出，此处如实描述为「等待模型响应」。
      return t('waitPhase.waiting_model', language as any)
  }
}

/** 计算变更统计 */
function computeChangeStats(changes: PendingChange[]) {
  let linesAdded = 0
  let linesRemoved = 0
  for (const change of changes) {
    linesAdded += change.linesAdded || 0
    linesRemoved += change.linesRemoved || 0
  }
  return { total: changes.length, linesAdded, linesRemoved }
}

/** 按目录分组变更 */
function groupChangesByDir(changes: PendingChange[]): Map<string, PendingChange[]> {
  const groups = new Map<string, PendingChange[]>()
  for (const change of changes) {
    const dir = getDirname(change.relativePath || change.filePath) || '.'
    const bucket = groups.get(dir) ?? []
    bucket.push(change)
    groups.set(dir, bucket)
  }
  return groups
}

/** 流式状态头部 */
function StreamingHeader({
  statusLabel,
  activeScenarioId,
  securityPolicyActive,
  onStop,
  language,
}: {
  statusLabel: string
  activeScenarioId?: string
  securityPolicyActive?: boolean
  onStop?: () => void
  language: string
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
        <span className="text-[12px] font-medium truncate">{statusLabel}</span>
        {activeScenarioId && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/5 text-accent text-[10px] font-medium flex-shrink-0">
            <Zap className="w-2.5 h-2.5" />
            {activeScenarioId}
          </span>
        )}
        {securityPolicyActive && <Shield className="w-3 h-3 text-accent/50 flex-shrink-0" />}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-text-muted/90 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all border border-transparent hover:border-red-500/20"
        >
          <Square className="w-2 h-2 fill-current" />
          <span>{t('statusBar.stop', language as any)}</span>
        </button>
      </div>
    </div>
  )
}

/** 审批状态头部 */
function ApprovalHeader({
  description,
  count,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
  language,
}: {
  description: string
  count: number
  onApprove?: () => void
  onReject?: () => void
  onApproveAll?: () => void
  onRejectAll?: () => void
  language: string
}) {
  const isBatch = count > 1
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse flex-shrink-0" />
        <span className="text-[12px] font-medium text-red-400/80 truncate">
          {isBatch
            ? t('statusBar.waitingApprovalBatch', language as any, { count })
            : description}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {isBatch ? (
          <>
            {onRejectAll && (
              <button
                onClick={onRejectAll}
                className="px-2 py-1 text-[11px] font-medium text-text-muted/85 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
              >
                {t('statusBar.rejectAllTools', language as any)}
              </button>
            )}
            {onApproveAll && (
              <button
                onClick={onApproveAll}
                className="px-2.5 py-1 text-[11px] font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all"
              >
                {t('statusBar.approveAllTools', language as any)}
              </button>
            )}
          </>
        ) : (
          <>
            {onReject && (
              <button
                onClick={onReject}
                className="px-2 py-1 text-[11px] font-medium text-text-muted/85 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
              >
                {t('statusBar.cancel', language as any)}
              </button>
            )}
            {onApprove && (
              <button
                onClick={onApprove}
                className="px-2.5 py-1 text-[11px] font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all"
              >
                {t('statusBar.approve', language as any)}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 审批列表 */
function ApprovalList({ items }: { items: { id: string; description: string }[] }) {
  return (
    <div className="border-t border-red-500/10 bg-red-500/[0.02]">
      <div className="px-4 py-1.5 space-y-0.5">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-2 text-[11px]">
            <span className="text-text-muted/50 w-4 text-right shrink-0">{idx + 1}</span>
            <span className="text-text-secondary/80 truncate">{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 变更摘要头部 */
function ChangesSummary({
  stats,
  isExpanded,
  onToggle,
  onViewAll,
  onUndoAll,
  onKeepAll,
  language,
}: {
  stats: { total: number; linesAdded: number; linesRemoved: number }
  isExpanded: boolean
  onToggle: () => void
  onViewAll?: () => void
  onUndoAll?: () => void
  onKeepAll?: () => void
  language: string
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors"
      onClick={onToggle}
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
            {stats.total}{' '}
            {stats.total > 1
              ? t('statusBar.filesChanged', language as any)
              : t('statusBar.fileChanged', language as any)}
          </span>
          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className="text-green-400/80">+{stats.linesAdded}</span>
            <span className="text-red-400/80">-{stats.linesRemoved}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {stats.total >= 2 && onViewAll && (
          <button
            onClick={onViewAll}
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
  )
}

/** 目录分组行 */
function DirGroupHeader({
  dir,
  count,
  expanded,
  onToggle,
}: {
  dir: string
  count: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-text-muted/85 hover:text-text-muted cursor-pointer hover:bg-surface-hover transition-colors"
      onClick={onToggle}
    >
      <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      <FolderOpen className="w-3 h-3 text-yellow-500/50" />
      <span className="font-medium">{dir || '.'}</span>
      <span className="text-[10px]">({count})</span>
    </div>
  )
}

/** 单个文件变更行 */
function FileChangeRow({
  change,
  onAccept,
  onReject,
  onReview,
  language,
}: {
  change: PendingChange
  onAccept: (e: React.MouseEvent, filePath: string) => void
  onReject: (e: React.MouseEvent, filePath: string) => void
  onReview: (e: React.MouseEvent, filePath: string) => void
  language: string
}) {
  const displayPath = change.relativePath || change.filePath
  const fileName = getFileName(displayPath)
  const visual = CHANGE_TYPE_VISUAL[change.changeType as keyof typeof CHANGE_TYPE_VISUAL] ?? CHANGE_TYPE_VISUAL.modify
  const TypeIcon = visual.Icon

  return (
    <div
      className="flex items-center justify-between px-4 py-2 hover:bg-surface-hover cursor-pointer transition-colors group"
      onClick={(e) => onReview(e, change.filePath)}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <TypeIcon className={`w-3.5 h-3.5 ${visual.color} shrink-0 group-hover:text-accent/60 transition-colors`} />
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

/** 变更列表展开区 */
function ChangesExpansion({
  groupedChanges,
  expandedDirs,
  onToggleDir,
  onAccept,
  onReject,
  onReview,
  language,
}: {
  groupedChanges: Map<string, PendingChange[]>
  expandedDirs: Set<string>
  onToggleDir: (dir: string) => void
  onAccept: (e: React.MouseEvent, filePath: string) => void
  onReject: (e: React.MouseEvent, filePath: string) => void
  onReview: (e: React.MouseEvent, filePath: string) => void
  language: string
}) {
  const multiDir = groupedChanges.size > 1
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="border-t border-border/50 max-h-[200px] overflow-y-auto custom-scrollbar">
        {Array.from(groupedChanges.entries()).map(([dir, dirChanges]) => {
          const expanded = expandedDirs.has(dir) || !multiDir
          return (
            <div key={dir}>
              {multiDir && (
                <DirGroupHeader
                  dir={dir}
                  count={dirChanges.length}
                  expanded={expanded}
                  onToggle={() => onToggleDir(dir)}
                />
              )}
              {expanded && (
                <div className={multiDir ? 'ml-4' : ''}>
                  {dirChanges.map((change) => (
                    <FileChangeRow
                      key={change.filePath}
                      change={change}
                      onAccept={onAccept}
                      onReject={onReject}
                      onReview={onReview}
                      language={language}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

function AgentStatusBar({
  pendingChanges,
  isStreaming,
  isAwaitingApproval,
  streamDetail,
  currentToolName,
  currentToolCall,
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
  onApproveAllTools,
  onRejectAllTools,
  pendingApprovalCount,
  pendingApprovalToolCalls,
  onViewAllChanges,
  activeScenarioId,
  securityPolicyActive,
}: AgentStatusBarProps) {
  const expandToolCallsByDefault = useStore((s) => s.agentConfig.expandToolCallsByDefault ?? false)
  const language = useStore((s) => s.language)
  const [isExpanded, setIsExpanded] = useState(expandToolCallsByDefault)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const stats = useMemo(() => computeChangeStats(pendingChanges), [pendingChanges])
  const groupedChanges = useMemo(() => groupChangesByDir(pendingChanges), [pendingChanges])

  const hasChanges = pendingChanges.length > 0
  const showBar = isStreaming || isAwaitingApproval || hasChanges

  const toolDisplayName = useMemo(() => {
    if (!currentToolName) return null
    return TOOL_LABEL_KEYS[currentToolName]
      ? t(TOOL_LABEL_KEYS[currentToolName] as any, language as any)
      : currentToolName
  }, [currentToolName, language])

  const approvalDescription = useMemo(() => {
    if (!isAwaitingApproval || !currentToolCall) return null
    return buildToolDescription(currentToolCall, language)
  }, [isAwaitingApproval, currentToolCall, language])

  const approvalList = useMemo(() => {
    if (!isAwaitingApproval || !pendingApprovalToolCalls || pendingApprovalToolCalls.length <= 1) return null
    return pendingApprovalToolCalls.map((tc) => ({
      id: tc.id,
      description: buildToolDescription(tc, language),
    }))
  }, [isAwaitingApproval, pendingApprovalToolCalls, language])

  const statusLabel = useMemo(() => {
    if (!isStreaming) return null
    const iterSuffix = iterationIndex && iterationIndex > 1 ? ` #${iterationIndex}` : ''
    if (currentTaskLabel && toolDisplayName) {
      return `${toolDisplayName} · ${currentTaskLabel}${iterSuffix}`
    }
    if (currentTaskLabel) return `${currentTaskLabel}${iterSuffix}`
    if (toolDisplayName) return `${toolDisplayName}${iterSuffix}`
    return `${resolveStreamLabel(streamDetail, language)}${iterSuffix}`
  }, [isStreaming, currentTaskLabel, toolDisplayName, streamDetail, language, iterationIndex])

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  const handleAccept = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation()
      onAcceptFile?.(filePath)
    },
    [onAcceptFile],
  )
  const handleReject = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation()
      onRejectFile?.(filePath)
    },
    [onRejectFile],
  )
  const handleReview = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation()
      onReviewFile?.(filePath)
    },
    [onReviewFile],
  )

  if (!showBar) return null

  const approvalCount = pendingApprovalCount ?? 1

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
      <div className="rounded-xl border border-border/50 bg-surface overflow-hidden shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] transition-all">
        {(isStreaming || isAwaitingApproval) && (
          <div className={hasChanges ? 'border-b border-border/50' : ''}>
            {isStreaming ? (
              <StreamingHeader
                statusLabel={statusLabel ?? ''}
                activeScenarioId={activeScenarioId}
                securityPolicyActive={securityPolicyActive}
                onStop={onStop}
                language={language}
              />
            ) : (
              <ApprovalHeader
                description={approvalDescription ?? t('statusBar.waitingApproval', language as any)}
                count={approvalCount}
                onApprove={onApproveTool}
                onReject={onRejectTool}
                onApproveAll={onApproveAllTools}
                onRejectAll={onRejectAllTools}
                language={language}
              />
            )}
          </div>
        )}

        {isAwaitingApproval && approvalList && approvalList.length > 0 && <ApprovalList items={approvalList} />}

        {hasChanges && (
          <>
            <ChangesSummary
              stats={stats}
              isExpanded={isExpanded}
              onToggle={() => setIsExpanded((v) => !v)}
              onViewAll={onViewAllChanges}
              onUndoAll={onUndoAll}
              onKeepAll={onKeepAll}
              language={language}
            />
            <AnimatePresence>
              {isExpanded && (
                <ChangesExpansion
                  groupedChanges={groupedChanges}
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onReview={handleReview}
                  language={language}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  )
}

export default memo(AgentStatusBar)
