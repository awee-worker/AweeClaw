import { useState, useCallback } from 'react'
import { Clock, CheckCircle2, XCircle, Trash2, RotateCcw, Workflow } from 'lucide-react'
import {
  loadWorkflowHistoryV2,
  deleteWorkflowRunV2,
  clearWorkflowHistoryV2,
} from '@shared/configuration/workflows/runHistoryV2'
import type { WorkflowRunV2, WorkflowRunStatusV2 } from '@shared/protocols/workflowV2'

interface WorkflowHistoryV2Props {
  onRerun: (workflowId: string) => void
  onOpenWorkflow: (workflowId: string) => void
  language: 'en' | 'zh'
}

const STATUS_COLORS: Record<WorkflowRunStatusV2, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-400',
  paused: 'text-amber-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-gray-400',
}

const STATUS_BG: Record<WorkflowRunStatusV2, string> = {
  pending: 'bg-gray-500/10',
  running: 'bg-blue-500/10',
  paused: 'bg-amber-500/10',
  completed: 'bg-green-500/10',
  failed: 'bg-red-500/10',
  cancelled: 'bg-gray-500/10',
}

const STATUS_ICONS: Record<WorkflowRunStatusV2, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  running: Clock,
  paused: Clock,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
}

export default function WorkflowHistoryV2({ onRerun, onOpenWorkflow, language }: WorkflowHistoryV2Props) {
  const [history, setHistory] = useState<WorkflowRunV2[]>(() => loadWorkflowHistoryV2())

  const handleDelete = useCallback((runId: string) => {
    deleteWorkflowRunV2(runId)
    setHistory(loadWorkflowHistoryV2())
  }, [])

  const handleClearAll = useCallback(() => {
    clearWorkflowHistoryV2()
    setHistory([])
  }, [])

  const formatTime = useCallback(
    (timestamp: number) => {
      const diffMs = Date.now() - timestamp
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return language === 'zh' ? '刚刚' : 'just now'
      if (diffMins < 60) return language === 'zh' ? `${diffMins}分钟前` : `${diffMins}m ago`
      if (diffHours < 24) return language === 'zh' ? `${diffHours}小时前` : `${diffHours}h ago`
      if (diffDays < 7) return language === 'zh' ? `${diffDays}天前` : `${diffDays}d ago`
      return new Date(timestamp).toLocaleDateString()
    },
    [language],
  )

  const statusLabel = useCallback(
    (status: WorkflowRunStatusV2) => {
      if (language === 'zh') {
        return { pending: '等待中', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[status]
      }
      return status.charAt(0).toUpperCase() + status.slice(1)
    },
    [language],
  )

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
        <Clock className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-xs">
          {language === 'zh' ? '暂无执行历史' : 'No execution history'}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {language === 'zh' ? '执行历史' : 'Execution History'}
        </h3>
        <button
          onClick={handleClearAll}
          className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors"
        >
          {language === 'zh' ? '清空' : 'Clear All'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {history.map(run => {
          const StatusIcon = STATUS_ICONS[run.status]
          const wfName = language === 'zh' ? run.workflowNameZh : run.workflowName
          const duration = run.completedAt
            ? run.completedAt - run.startedAt
            : Date.now() - run.startedAt

          return (
            <div
              key={run.id}
              className="group p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)]/5 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`p-1.5 rounded-lg ${STATUS_BG[run.status]}`}>
                  <StatusIcon className={`w-3.5 h-3.5 ${STATUS_COLORS[run.status]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {wfName}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[run.status]} ${STATUS_BG[run.status]}`}>
                      {statusLabel(run.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {formatTime(run.startedAt)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {run.nodeResults.length} {language === 'zh' ? '节点' : 'nodes'}
                    </span>
                    {run.completedAt && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
                      </span>
                    )}
                  </div>
                  {run.error && (
                    <p className="text-[10px] text-red-400/70 mt-1 line-clamp-1">
                      {run.error}
                    </p>
                  )}
                  {run.nodeResults.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {run.nodeResults.slice(0, 8).map(nr => (
                        <span
                          key={nr.nodeId}
                          className={`w-1.5 h-1.5 rounded-full ${
                            nr.status === 'success' ? 'bg-green-400' : nr.status === 'failed' ? 'bg-red-400' : 'bg-gray-400'
                          }`}
                          title={`${nr.nodeName}: ${nr.status}`}
                        />
                      ))}
                      {run.nodeResults.length > 8 && (
                        <span className="text-[9px] text-[var(--text-muted)]">
                          +{run.nodeResults.length - 8}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onOpenWorkflow(run.workflowId)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                    title={language === 'zh' ? '打开工作流' : 'Open Workflow'}
                  >
                    <Workflow className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onRerun(run.workflowId)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                    title={language === 'zh' ? '重新运行' : 'Re-run'}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(run.id)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title={language === 'zh' ? '删除' : 'Delete'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
