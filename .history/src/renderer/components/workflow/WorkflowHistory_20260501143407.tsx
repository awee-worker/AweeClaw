import { useState, useMemo, useCallback } from 'react'
import {
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { loadWorkflowHistory, deleteWorkflowRun, clearWorkflowHistory } from '@shared/config/workflows/persistence'
import { workflowEngine } from '@shared/types/workflow'
import type { WorkflowRun, WorkflowRunStatus } from '@shared/types/workflow'

interface WorkflowHistoryProps {
  onRerun: (workflowId: string) => void
  language: 'en' | 'zh'
}

const STATUS_COLORS: Record<WorkflowRunStatus, string> = {
  'pending': 'text-gray-400',
  'running': 'text-blue-400',
  'paused': 'text-amber-400',
  'completed': 'text-green-400',
  'failed': 'text-red-400',
  'cancelled': 'text-gray-400',
}

const STATUS_BG: Record<WorkflowRunStatus, string> = {
  'pending': 'bg-gray-500/10',
  'running': 'bg-blue-500/10',
  'paused': 'bg-amber-500/10',
  'completed': 'bg-green-500/10',
  'failed': 'bg-red-500/10',
  'cancelled': 'bg-gray-500/10',
}

const STATUS_ICONS: Record<WorkflowRunStatus, React.ComponentType<{ className?: string }>> = {
  'pending': Clock,
  'running': Clock,
  'paused': Clock,
  'completed': CheckCircle2,
  'failed': XCircle,
  'cancelled': XCircle,
}

export default function WorkflowHistory({ onRerun, language }: WorkflowHistoryProps) {
  const [history, setHistory] = useState<WorkflowRun[]>(() => loadWorkflowHistory())

  const handleDelete = useCallback((runId: string) => {
    deleteWorkflowRun(runId)
    setHistory(loadWorkflowHistory())
  }, [])

  const handleClearAll = useCallback(() => {
    clearWorkflowHistory()
    setHistory([])
  }, [])

  const handleRerun = useCallback((workflowId: string) => {
    onRerun(workflowId)
  }, [onRerun])

  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return language === 'zh' ? '刚刚' : 'just now'
    if (diffMins < 60) return language === 'zh' ? `${diffMins}分钟前` : `${diffMins}m ago`
    if (diffHours < 24) return language === 'zh' ? `${diffHours}小时前` : `${diffHours}h ago`
    if (diffDays < 7) return language === 'zh' ? `${diffDays}天前` : `${diffDays}d ago`
    return date.toLocaleDateString()
  }, [language])

  const statusLabel = useCallback((status: WorkflowRunStatus) => {
    if (language === 'zh') {
      return { pending: '等待中', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[status]
    }
    return status.charAt(0).toUpperCase() + status.slice(1)
  }, [language])

  const workflowNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const wf of workflowEngine.getAll()) {
      map.set(wf.id, wf.nameZh && language === 'zh' ? wf.nameZh : wf.name)
    }
    return map
  }, [language])

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted/40">
        <Clock className="w-10 h-10 mb-3" />
        <p className="text-[13px]">
          {language === 'zh' ? '暂无执行历史' : 'No execution history'}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30">
        <h3 className="text-[12px] font-semibold text-text-secondary">
          {language === 'zh' ? '执行历史' : 'Execution History'}
        </h3>
        <button
          onClick={handleClearAll}
          className="text-[10px] text-text-muted/50 hover:text-red-400 transition-colors"
        >
          {language === 'zh' ? '清空' : 'Clear All'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-2">
        {history.map(run => {
          const StatusIcon = STATUS_ICONS[run.status]
          const wfName = workflowNames.get(run.workflowId) || run.workflowId
          const duration = run.completedAt
            ? run.completedAt - run.startedAt
            : Date.now() - run.startedAt

          return (
            <div
              key={run.id}
              className="group p-3 rounded-lg border border-border/30 bg-surface/20 hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`p-1.5 rounded-lg ${STATUS_BG[run.status]}`}>
                  <StatusIcon className={`w-3.5 h-3.5 ${STATUS_COLORS[run.status]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-text-primary truncate">
                      {wfName}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[run.status]} ${STATUS_BG[run.status]}`}>
                      {statusLabel(run.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-text-muted/50">
                      {formatTime(run.startedAt)}
                    </span>
                    <span className="text-[10px] text-text-muted/50">
                      {run.stepHistory.length} {language === 'zh' ? '步骤' : 'steps'}
                    </span>
                    {run.completedAt && (
                      <span className="text-[10px] text-text-muted/50">
                        {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
                      </span>
                    )}
                  </div>
                  {run.error && (
                    <p className="text-[10px] text-red-400/70 mt-1 line-clamp-1">
                      {run.error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleRerun(run.workflowId)}
                    className="p-1 rounded text-text-muted/50 hover:text-accent hover:bg-accent/10 transition-colors"
                    title={language === 'zh' ? '重新运行' : 'Re-run'}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(run.id)}
                    className="p-1 rounded text-text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
