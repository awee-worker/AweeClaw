/**
 * 待确认操作栏（事前审批统一入口）
 *
 * 在输入框上方把本轮等待用户放行的工具调用汇成一条，会话消息流里的工具卡片不再
 * 逐张内嵌批准按钮：审批针对的是「这一步要不要执行」，不是某条消息的附属内容。
 * 放到操作区一次确认更贴近用户心智，也不会随消息滚动跑出视野。
 *
 * 数据来源：useAgentStore 当前线程的 streamState.pendingApprovalToolCalls
 * 操作：批准 / 拒绝由调用方注入，与旧的卡片内按钮走同一条审批链路
 */
import { memo, useMemo, useState } from 'react'
import { AlertTriangle, Check, X, ChevronDown, ChevronUp, FileCode, FilePlus, FolderPlus, Terminal, Globe } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getPrimaryToolPath } from './toolCallCard/helpers'
import { getFriendlyToolName } from '@intelligence/display/toolFriendlyName'
import { isDirectoryCreation } from '@intelligence/decision/approvalEscalation'
import { TRUST_CHANNEL_LABELS } from '@intelligence/types/trustTypes'
import type { PendingToolApproval } from '@intelligence/types/dialogThreadModel'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'

const EMPTY_PENDING: PendingToolApproval[] = []

interface PendingApprovalBarProps {
  /** 批准当前全部待确认操作 */
  onApprove: () => void
  /** 拒绝当前全部待确认操作 */
  onReject: () => void
}

/** 按工具语义选择操作图标 */
function resolveToolIcon(tc: PendingToolApproval) {
  if (tc.name === 'run_command') return Terminal
  if (tc.name === 'web_search' || tc.name === 'read_url') return Globe
  if (isDirectoryCreation(tc.name, tc.arguments)) return FolderPlus
  if (tc.name === 'create_file_or_folder' || tc.name === 'write_file') return FilePlus
  return FileCode
}

/** 单条操作的摘要文本 */
function describeOperation(tc: PendingToolApproval, isZh: boolean): string {
  const label = getFriendlyToolName(tc.name, isZh ? 'zh' : 'en').label || tc.name

  if (isDirectoryCreation(tc.name, tc.arguments)) {
    const path = getPrimaryToolPath(tc.arguments) || ''
    return isZh ? `创建目录 ${path}` : `Create folder ${path}`
  }

  const command = tc.arguments?.command
  if (tc.name === 'run_command' && typeof command === 'string') {
    const short = command.length > 70 ? `${command.slice(0, 70)}...` : command
    return short
  }

  const path = getPrimaryToolPath(tc.arguments)
  if (path) return `${label} ${path}`

  return label
}

/** 汇总待确认操作受外部内容影响的情况 */
function buildUntrustedNotice(pending: PendingToolApproval[]): string {
  const labels = new Set<string>()
  for (const item of pending) {
    for (const src of item.untrustedSources ?? []) {
      const channel = TRUST_CHANNEL_LABELS[src.channel] ?? src.channel
      labels.add(src.locator ? `${channel} ${src.locator}` : channel)
    }
  }
  return Array.from(labels).slice(0, 3).join('、')
}

function PendingApprovalBarBase({ onApprove, onReject }: PendingApprovalBarProps) {
  const language = useStore((s) => s.language)
  const isZh = language === 'zh'
  const [isExpanded, setIsExpanded] = useState(false)

  // 订阅当前线程的待确认列表：切片只取该字段，避免流式文本推进时无谓重渲染
  const pending = useAgentStore(
    useShallow((s) => {
      const threadId = s.currentThreadId
      if (!threadId) return EMPTY_PENDING
      return s.threads[threadId]?.streamState?.pendingApprovalToolCalls ?? EMPTY_PENDING
    }),
  )

  const items = useMemo(
    () => pending.map((tc) => ({ id: tc.id, icon: resolveToolIcon(tc), text: describeOperation(tc, isZh) })),
    [pending, isZh],
  )

  const untrustedNotice = useMemo(() => buildUntrustedNotice(pending), [pending])

  if (pending.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="mb-2 rounded-lg border border-status-warning/30 bg-status-warning/5 overflow-hidden"
    >
      {/* 头部：说明 + 展开列表 + 批准/拒绝 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-status-warning/5 rounded-md transition-colors px-1 py-0.5"
          title={isZh ? '展开查看待确认的操作' : 'Show pending operations'}
        >
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-status-warning shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-status-warning shrink-0" />
          )}
          <AlertTriangle className="w-3.5 h-3.5 text-status-warning shrink-0" />
          <span className="text-xs font-medium text-status-warning truncate">
            {isZh
              ? `${pending.length} 项操作待确认`
              : `${pending.length} operation${pending.length > 1 ? 's' : ''} awaiting confirmation`}
          </span>
          {!isExpanded && (
            <span className="text-[11px] text-text-muted truncate flex-1">{items[0]?.text}</span>
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-all active:scale-95"
          >
            <X className="w-3.5 h-3.5" />
            {isZh ? '全部拒绝' : 'Reject all'}
          </button>
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            {isZh ? '全部批准' : 'Approve all'}
          </button>
        </div>
      </div>

      {/* 外部内容影响提示：说明这次操作为什么被拦下来 */}
      {untrustedNotice && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary leading-relaxed border-t border-status-warning/15 pt-1.5">
          {isZh ? '本次操作可能受外部内容影响，来源：' : 'This may be influenced by external content from: '}
          <span className="text-text-primary">{untrustedNotice}</span>
        </div>
      )}

      {/* 展开的操作列表 */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="border-t border-status-warning/15 overflow-hidden"
          >
            <div className="max-h-[240px] overflow-y-auto py-1">
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-status-warning/5 transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="text-xs text-text-primary truncate flex-1">{item.text}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default memo(PendingApprovalBarBase)
