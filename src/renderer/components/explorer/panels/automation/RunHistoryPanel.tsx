/**
 * RunHistoryPanel — 自动化运行历史面板
 *
 * 展示规则的执行历史记录：
 * - 执行状态（成功/失败/超时）
 * - 耗时、触发类型
 * - 错误信息
 * - 时间线展示
 */
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import type { AutomationRun } from '../tasks/types'

interface RunHistoryPanelProps {
  runs: AutomationRun[]
  loading: boolean
  isZh: boolean
}

export function RunHistoryPanel({ runs, loading, isZh }: RunHistoryPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Clock className="w-8 h-8 mb-2 opacity-25" />
        <p className="text-[13px]">{isZh ? '暂无运行记录' : 'No run history'}</p>
        <p className="text-[12px] mt-1 text-text-muted/60">
          {isZh ? '手动执行或等待触发器触发后会出现记录' : 'Records will appear after manual runs or triggers'}
        </p>
      </div>
    )
  }

  // 统计
  const success = runs.filter(r => r.status === 'SUCCESS').length
  const failed = runs.filter(r => r.status === 'FAILED').length
  const timeout = runs.filter(r => r.status === 'TIMEOUT').length

  return (
    <div className="p-5 max-w-3xl">
      {/* 统计概览 */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-[12px]">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          <span className="text-text-muted">{isZh ? '成功' : 'Success'}</span>
          <span className="font-semibold text-text-primary">{success}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[12px]">
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-text-muted">{isZh ? '失败' : 'Failed'}</span>
          <span className="font-semibold text-text-primary">{failed}</span>
        </div>
        {timeout > 0 && (
          <div className="flex items-center gap-1.5 text-[12px]">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-text-muted">{isZh ? '超时' : 'Timeout'}</span>
            <span className="font-semibold text-text-primary">{timeout}</span>
          </div>
        )}
      </div>

      {/* 时间线 */}
      <div className="relative">
        <div className="absolute left-3 top-0 bottom-0 w-px bg-border/30" />
        <div className="space-y-3">
          {runs.map(run => (
            <RunRecord key={run.id} run={run} isZh={isZh} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RunRecord({ run, isZh }: { run: AutomationRun; isZh: boolean }) {
  const statusConfig = {
    SUCCESS: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500' },
    FAILED: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500' },
    TIMEOUT: { icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500' },
    RUNNING: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500' },
  }
  const config = statusConfig[run.status] || statusConfig.SUCCESS
  const Icon = config.icon
  const date = new Date(run.startedAt)

  return (
    <div className="relative flex items-start gap-3 pl-1">
      {/* 节点 */}
      <div className={`relative z-10 w-6 h-6 rounded-full ${config.bg}/15 flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-3.5 h-3.5 ${config.color} ${run.status === 'RUNNING' ? 'animate-spin' : ''}`} />
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[13px] font-medium ${config.color}`}>
            {run.status === 'SUCCESS' ? (isZh ? '成功' : 'Success')
              : run.status === 'FAILED' ? (isZh ? '失败' : 'Failed')
              : run.status === 'TIMEOUT' ? (isZh ? '超时' : 'Timeout')
              : isZh ? '运行中' : 'Running'}
          </span>
          <span className="text-[11px] text-text-muted">
            {run.triggerType}
          </span>
          <span className="text-[11px] text-text-muted">
            {run.durationMs}ms
          </span>
          <span className="text-[11px] text-text-muted ml-auto">
            {date.toLocaleString(isZh ? 'zh-CN' : 'en-US', {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            })}
          </span>
        </div>
        {run.error && (
          <div className="text-[12px] text-red-500 bg-red-500/5 rounded-md px-2 py-1 mt-1 break-all">
            {run.error}
          </div>
        )}
        {run.output != null && typeof run.output === 'object' && (
          <details className="mt-1">
            <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text-primary">
              {isZh ? '查看输出' : 'View output'}
            </summary>
            <pre className="text-[11px] text-text-secondary bg-surface/30 rounded-md p-2 mt-1 overflow-x-auto font-mono">
              {JSON.stringify(run.output, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
