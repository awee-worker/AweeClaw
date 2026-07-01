/**
 * 批量批准面板
 *
 * 当多个工具同时等待用户批准时，将所有待批准操作汇总到一个统一面板，
 * 列出每项操作的目标和类型，用户可一次性批准或拒绝全部。
 *
 * 设计原则：
 * - 取代多个分散的单卡批准框，避免用户逐个点击
 * - 清晰列出所有待批准内容，让用户充分知情后决策
 * - 视觉层级最高（红色警告样式），确保用户注意到
 */

import { memo, useMemo } from 'react'
import { Check, X, AlertTriangle, FileText, Terminal, Globe, MousePointer, Folder } from 'lucide-react'
import type { ToolCall } from '@intelligence/providerTypes'
import { getPrimaryToolPath } from './helpers'
import { getFriendlyToolName } from '@intelligence/display/toolFriendlyName'
import { useStore } from '@store'
import type { Language } from '@renderer/i18n'

interface BatchApprovalPanelProps {
  /** 所有等待批准的工具调用 */
  toolCalls: ToolCall[]
  /** 批准全部回调（底层会遍历 pendingApprovalToolCalls 逐个批准） */
  onApproveAll: () => void
  /** 拒绝全部回调 */
  onRejectAll: () => void
}

/** 根据工具名获取操作图标 */
function getToolIcon(toolName: string) {
  if (toolName.startsWith('desktop_')) return MousePointer
  if (toolName === 'run_command') return Terminal
  if (['web_search', 'read_url'].includes(toolName)) return Globe
  if (['delete_file_or_folder', 'create_file_or_folder'].includes(toolName)) return Folder
  return FileText
}

/** 提取单个工具的操作摘要 */
function getOperationSummary(tc: ToolCall, language: Language): string {
  const args = (tc.arguments || {}) as Record<string, unknown>
  const path = getPrimaryToolPath(args)
  const friendly = getFriendlyToolName(tc.name, language)
  const label = friendly.label || tc.name

  // 有路径的操作：显示 "操作类型 文件名"
  if (path) {
    const fileName = path.split('/').pop() || path
    return `${label} ${fileName}`
  }

  // 命令类：显示命令内容
  if (tc.name === 'run_command' && typeof args.command === 'string') {
    const cmd = args.command.length > 60 ? args.command.slice(0, 60) + '...' : args.command
    return `${label} ${cmd}`
  }

  // 其他：仅显示工具友好名
  return label
}

function BatchApprovalPanelImpl({
  toolCalls,
  onApproveAll,
  onRejectAll,
}: BatchApprovalPanelProps) {
  const language = useStore((s) => s.language)

  // 计算每项的操作摘要
  const summaries = useMemo(
    () => toolCalls.map((tc) => ({
      id: tc.id,
      icon: getToolIcon(tc.name),
      text: getOperationSummary(tc, language),
      toolName: tc.name,
    })),
    [toolCalls, language],
  )

  if (toolCalls.length === 0) return null

  return (
    <div className="mt-2 rounded-lg border border-status-warning/30 bg-status-warning/5 overflow-hidden">
      {/* 头部：警告标题 + 计数 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/10 border-b border-status-warning/20">
        <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
        <span className="text-sm font-medium text-status-warning">
          待批准操作
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-status-warning/20 text-status-warning font-mono">
          {toolCalls.length}
        </span>
        <span className="text-xs text-status-warning/60 ml-auto">
          请确认后批量执行
        </span>
      </div>

      {/* 操作列表 */}
      <div className="max-h-48 overflow-y-auto py-1">
        {summaries.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-status-warning/5 transition-colors"
            >
              <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="text-xs text-text-primary truncate flex-1">
                {item.text}
              </span>
              <span className="text-[10px] text-text-muted opacity-60 font-mono shrink-0">
                {item.toolName}
              </span>
            </div>
          )
        })}
      </div>

      {/* 底部：批准/拒绝按钮 */}
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-status-warning/20 bg-status-warning/5">
        <button
          onClick={onRejectAll}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-all"
        >
          <X className="w-3.5 h-3.5" />
          全部拒绝
        </button>
        <button
          onClick={onApproveAll}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95"
        >
          <Check className="w-3.5 h-3.5" />
          全部批准
        </button>
      </div>
    </div>
  )
}

export default memo(BatchApprovalPanelImpl)
