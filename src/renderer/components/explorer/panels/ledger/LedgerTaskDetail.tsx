/**
 * 任务中心 — 任务详情
 *
 * 右侧常驻栏：把一条任务的全部上下文摊开，避免列表里逐行展开导致
 * 高度跳动。窄屏下由外层切换成覆盖层，因此这里只关心内容本身。
 *
 * 分区顺序按「先结论、再证据」排：概要 → 元信息 → 进度 → 结果 → 错误 → trace。
 *
 * @module explorer/panels/ledger/LedgerTaskDetail
 */

import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react'
import type { LedgerTaskView } from '@renderer/types/electronBridge'
import {
  ORIGIN_META,
  RISK_META,
  STATUS_META,
  formatDuration,
  formatTime,
  taskDuration,
} from './ledgerMeta'

export interface LedgerTaskDetailProps {
  task: LedgerTaskView | null
  busy: boolean
  isZh: boolean
  onStart: (task: LedgerTaskView) => void
  onApprove: (task: LedgerTaskView) => void
  onRetry: (task: LedgerTaskView) => void
  onCancel: (task: LedgerTaskView) => void
  /** 窄屏覆盖层里的关闭按钮；宽屏常驻时不显示 */
  onClose?: () => void
}

/** 元信息的一格：标签在上、值在下，避免长值把标签挤到换行 */
function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-[12px] text-text-primary break-all">{children}</dd>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
  tone,
}: {
  title: string
  icon: typeof Clock
  children: React.ReactNode
  tone?: string
}) {
  return (
    <section className="border-t border-border/25 px-4 py-3 first:border-t-0">
      <h3 className={`flex items-center gap-1.5 text-[11px] font-medium ${tone ?? 'text-text-muted'}`}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function LedgerTaskDetail({
  task,
  busy,
  isZh,
  onStart,
  onApprove,
  onRetry,
  onCancel,
  onClose,
}: LedgerTaskDetailProps) {
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full px-6 text-center">
        <FileText className="w-8 h-8 text-text-muted/40" aria-hidden="true" />
        <p className="text-[13px] text-text-secondary">{isZh ? '选择左侧任务查看详情' : 'Select a task to inspect'}</p>
        <p className="text-[11px] text-text-muted/70 leading-relaxed max-w-[240px]">
          {isZh
            ? '任务的执行过程、结果产物与错误信息都会在这里展开。'
            : 'Execution trace, artifacts and errors show up here.'}
        </p>
      </div>
    )
  }

  const status = STATUS_META[task.status]
  const origin = ORIGIN_META[task.origin]
  const risk = RISK_META[task.risk]
  const StatusIcon = status.icon
  const OriginIcon = origin.icon
  const duration = taskDuration(task)
  const artifacts = task.result?.artifacts ?? []
  const trace = task.trace ?? []
  const progress = typeof task.progress === 'number' ? Math.max(0, Math.min(100, task.progress)) : null

  const canApprove = task.status === 'pending_approval'
  const canStart = task.status === 'queued'
  const canRetry = task.status === 'failed' || task.status === 'cancelled'
  const canCancel = task.status === 'running' || task.status === 'queued' || canApprove

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部：结论先行 */}
      <div className="shrink-0 px-4 py-3 border-b border-border/30">
        <div className="flex items-start gap-2">
          <StatusIcon
            className={`w-4 h-4 mt-1 shrink-0 ${status.text} ${task.status === 'running' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <h2 className="flex-1 min-w-0 text-[13px] font-medium text-text-primary break-words leading-relaxed">
            {task.title}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={isZh ? '关闭详情' : 'Close detail'}
              className="shrink-0 p-1 -mr-1 -mt-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${status.chip}`}>
            {isZh ? status.labelZh : status.label}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/50 bg-surface/40 text-[11px] text-text-secondary">
            <OriginIcon className="w-3 h-3" aria-hidden="true" />
            {isZh ? origin.labelZh : origin.label}
          </span>
          <span className={`px-1.5 py-0.5 rounded border text-[11px] ${risk.chip}`}>
            {isZh ? risk.labelZh : risk.label}
          </span>
          {task.kind && (
            <span className="px-1.5 py-0.5 rounded border border-border/40 text-[11px] text-text-muted max-w-[160px] truncate" title={task.kind}>
              {task.kind}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 进度：只在执行中或有明确进度时出现 */}
        {progress !== null && task.status === 'running' && (
          <Section title={isZh ? '执行进度' : 'Progress'} icon={Loader2}>
            <div className="h-1.5 rounded-full bg-surface/70 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
              <span className="truncate">{task.progressMsg || (isZh ? '执行中…' : 'Running…')}</span>
              <span className="tabular-nums shrink-0">{Math.round(progress)}%</span>
            </div>
          </Section>
        )}

        <Section title={isZh ? '基本信息' : 'Overview'} icon={Clock}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <MetaItem label={isZh ? '任务 ID' : 'Task ID'}>
              <span className="font-mono text-[11px]">{task.id}</span>
            </MetaItem>
            <MetaItem label={isZh ? '触发来源' : 'Origin'}>
              {isZh ? origin.labelZh : origin.label}
              {task.originId ? <span className="text-text-muted"> · {task.originId}</span> : null}
            </MetaItem>
            <MetaItem label={isZh ? '创建时间' : 'Created'}>{formatTime(task.createdAt)}</MetaItem>
            <MetaItem label={isZh ? '结束时间' : 'Finished'}>{formatTime(task.finishedAt)}</MetaItem>
            <MetaItem label={isZh ? '耗时' : 'Duration'}>
              {task.status === 'running'
                ? formatDuration(task.createdAt, null)
                : duration !== null
                  ? formatDuration(task.createdAt, task.finishedAt)
                  : '-'}
            </MetaItem>
            <MetaItem label={isZh ? '最近更新' : 'Updated'}>{formatTime(task.updatedAt)}</MetaItem>
          </dl>
        </Section>

        {task.result?.summary && (
          <Section title={isZh ? '结果摘要' : 'Result summary'} icon={CheckCircle2} tone="text-emerald-500">
            <p className="text-[12px] text-text-primary leading-relaxed break-words">{task.result.summary}</p>
          </Section>
        )}

        {artifacts.length > 0 && (
          <Section title={isZh ? `产物（${artifacts.length}）` : `Artifacts (${artifacts.length})`} icon={Link2}>
            <ul className="space-y-1.5">
              {artifacts.map((artifact, index) => (
                <li
                  key={`${artifact.title}-${index}`}
                  className="rounded-lg border border-border/40 bg-surface/30 px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    {artifact.type === 'url' ? (
                      <Link2 className="w-3 h-3 text-text-muted shrink-0" aria-hidden="true" />
                    ) : (
                      <FileText className="w-3 h-3 text-text-muted shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-[12px] text-text-primary truncate" title={artifact.title}>
                      {artifact.title}
                    </span>
                    <span className="ml-auto text-[10px] uppercase text-text-muted/70 shrink-0">{artifact.type}</span>
                  </div>
                  {(artifact.url || artifact.path) && (
                    <p className="mt-1 text-[11px] text-text-muted break-all">{artifact.url ?? artifact.path}</p>
                  )}
                  {artifact.content && (
                    <pre className="mt-1 max-h-32 overflow-auto text-[11px] text-text-secondary whitespace-pre-wrap break-all font-mono">
                      {artifact.content}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {task.result?.output && (
          <Section title={isZh ? '原始输出' : 'Raw output'} icon={FileText}>
            <pre className="max-h-56 overflow-auto rounded-lg bg-surface/40 border border-border/30 p-2.5 text-[11px] text-text-secondary whitespace-pre-wrap break-all font-mono">
              {task.result.output}
            </pre>
          </Section>
        )}

        {(task.error || task.result?.error) && (
          <Section title={isZh ? '错误信息' : 'Error'} icon={AlertCircle} tone="text-red-500">
            <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-2.5 py-2 text-[11px] text-red-500 whitespace-pre-wrap break-all">
              {task.error ?? task.result?.error}
            </p>
          </Section>
        )}

        <Section title={isZh ? `执行轨迹（${trace.length}）` : `Trace (${trace.length})`} icon={ShieldAlert}>
          {trace.length === 0 ? (
            <p className="text-[11px] text-text-muted/70">{isZh ? '暂无轨迹记录' : 'No trace recorded'}</p>
          ) : (
            <ol className="relative pl-4">
              {/* 竖线贯穿整条时间线，最后一项不再画，避免尾部悬空 */}
              <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border/50" aria-hidden="true" />
              {trace.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="relative pb-2.5 last:pb-0">
                  <span
                    className="absolute -left-4 top-1.5 w-[7px] h-[7px] rounded-full bg-border border-2 border-background"
                    aria-hidden="true"
                  />
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-[11px] text-text-primary">{entry.actor}</span>
                    <span className="text-[10px] text-text-muted tabular-nums">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-secondary leading-relaxed break-words">{entry.message}</p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      {/* 操作栏：只在有可用动作时出现，避免空栏占高度 */}
      {(canApprove || canStart || canRetry || canCancel) && (
        <div className="shrink-0 px-4 py-2.5 border-t border-border/30 flex items-center gap-2">
          {canApprove && (
            <button
              type="button"
              onClick={() => onApprove(task)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-amber-400/40 text-amber-500 text-[12px] hover:bg-amber-400/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
              {isZh ? '放行执行' : 'Approve'}
            </button>
          )}
          {canStart && (
            <button
              type="button"
              onClick={() => onStart(task)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
              {isZh ? '开始执行' : 'Start'}
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetry(task)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/60 text-text-primary text-[12px] hover:bg-surface/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {isZh ? '重试' : 'Retry'}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => onCancel(task)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/60 text-text-muted text-[12px] hover:text-red-500 hover:border-red-400/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Ban className="w-3.5 h-3.5" aria-hidden="true" />
              {isZh ? '取消' : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default LedgerTaskDetail
