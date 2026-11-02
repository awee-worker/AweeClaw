/**
 * 任务中心 — 事件触发的本地任务列表
 *
 * 数据源：主进程 TaskLedger（纯本地，不依赖后端登录）
 * 与 ScheduleExplorer 的区别：那边是"定时到点执行"，这边是"事件发生后的任务记录"。
 *
 * 视图结构（自上而下）：
 *   LedgerExplorer      容器：拉数据、订阅增量、持有开关状态
 *   ├ LedgerSettingsBar 三层开关：事件监听 / 自动建任务 / 自动执行
 *   └ LedgerTaskRow     单条任务：折叠态摘要 + 展开态 trace / 结果
 *
 * @module explorer/panels/ledger/LedgerExplorer
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { useStore } from '@store'
import type {
  AutomationSettingsView,
  LedgerTaskView,
} from '@renderer/types/electronBridge'
import { executeLedgerTask, isTaskInflight } from '@components/intelligence/proactive/ledgerTaskExecutor'

type TaskStatus = LedgerTaskView['status']

/** 状态展示配置：颜色与图标只在这里定义一次，列表与详情共用 */
const STATUS_META: Record<
  TaskStatus,
  { dot: string; text: string; icon: typeof Clock; labelZh: string; label: string }
> = {
  pending_approval: {
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    icon: ShieldAlert,
    labelZh: '待审批',
    label: 'Pending approval',
  },
  queued: {
    dot: 'bg-slate-400',
    text: 'text-slate-400',
    icon: Clock,
    labelZh: '等待执行',
    label: 'Queued',
  },
  running: {
    dot: 'bg-blue-400',
    text: 'text-blue-400',
    icon: Loader2,
    labelZh: '执行中',
    label: 'Running',
  },
  completed: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    icon: CheckCircle2,
    labelZh: '已完成',
    label: 'Completed',
  },
  failed: {
    dot: 'bg-red-400',
    text: 'text-red-400',
    icon: XCircle,
    labelZh: '失败',
    label: 'Failed',
  },
  cancelled: {
    dot: 'bg-slate-500',
    text: 'text-slate-500',
    icon: Ban,
    labelZh: '已取消',
    label: 'Cancelled',
  },
}

function formatTime(ts: number | null): string {
  if (!ts || ts <= 0) return '-'
  return new Date(ts).toLocaleString()
}

function formatDuration(from: number, to: number | null): string {
  const end = to ?? Date.now()
  const ms = Math.max(0, end - from)
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

/** 通用开关按钮，避免三处各写一遍 aria 与焦点样式 */
function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">{label}</div>
        <div className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 mt-0.5 h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-accent/80 hover:bg-accent' : 'bg-border/60 hover:bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

/** 三层开关 */
function LedgerSettingsBar({
  settings,
  onChange,
  saving,
}: {
  settings: AutomationSettingsView
  onChange: (patch: Partial<AutomationSettingsView>) => void
  saving: boolean
}) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  return (
    <section className="border-b border-border/40 shrink-0" aria-label={isZh ? '自动化开关' : 'Automation switches'}>
      <ToggleSwitch
        checked={settings.triggersEnabled}
        onChange={(next) => onChange({ triggersEnabled: next })}
        disabled={saving}
        label={isZh ? '监听事件' : 'Watch events'}
        description={
          isZh
            ? '监听文件变更与工具调用事件。关闭后不注册任何事件源，重启生效。'
            : 'Watch file changes and tool calls. Takes effect after restart.'
        }
      />
      <ToggleSwitch
        checked={settings.autoCreateTask}
        onChange={(next) => onChange({ autoCreateTask: next })}
        disabled={saving}
        label={isZh ? '自动建任务' : 'Auto-create tasks'}
        description={
          isZh
            ? '事件命中后自动建一条任务记录。纯本地写入，不产生模型开销。'
            : 'Create a task record on each hit. Local write only, no model cost.'
        }
      />
      <ToggleSwitch
        checked={settings.autoExecuteTask}
        onChange={(next) => onChange({ autoExecuteTask: next })}
        disabled={saving}
        label={isZh ? '自动执行' : 'Auto-execute'}
        description={
          isZh
            ? '建完立即交给 Agent 执行。这是唯一会消耗 token 的开关，默认关闭。'
            : 'Hand the task to the Agent immediately. The only switch that costs tokens.'
        }
      />
    </section>
  )
}

/** 单条任务：折叠态一行摘要，展开后显示 trace 与结果 */
function LedgerTaskRow({
  task,
  expanded,
  onToggle,
  onStart,
  onCancel,
  onRetry,
  onApprove,
  busy,
}: {
  task: LedgerTaskView
  expanded: boolean
  onToggle: () => void
  onStart: () => void
  onCancel: () => void
  onRetry: () => void
  onApprove: () => void
  busy: boolean
}) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  const meta = STATUS_META[task.status]
  const StatusIcon = meta.icon
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <li className="border-b border-border/30 last:border-b-0">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-surface/40 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-start gap-2 min-w-0 flex-1 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Chevron className="w-3.5 h-3.5 mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
          <StatusIcon
            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.text} ${task.status === 'running' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-text-primary truncate">{task.title}</span>
            <span className="block text-[11px] text-text-muted mt-0.5">
              {isZh ? meta.labelZh : meta.label}
              <span className="mx-1.5 opacity-40">·</span>
              {formatTime(task.createdAt)}
              {task.status === 'running' && (
                <>
                  <span className="mx-1.5 opacity-40">·</span>
                  {formatDuration(task.createdAt, null)}
                </>
              )}
            </span>
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {task.status === 'pending_approval' && (
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="px-2 py-1 text-[11px] rounded border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isZh ? '放行' : 'Approve'}
            </button>
          )}
          {task.status === 'queued' && (
            <button
              type="button"
              onClick={onStart}
              disabled={busy}
              className="p-1 rounded text-text-muted hover:text-emerald-400 hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={isZh ? '开始执行' : 'Start'}
              title={isZh ? '开始执行' : 'Start'}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <button
              type="button"
              onClick={onRetry}
              disabled={busy}
              className="p-1 rounded text-text-muted hover:text-blue-400 hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={isZh ? '重试' : 'Retry'}
              title={isZh ? '重试' : 'Retry'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {(task.status === 'queued' ||
            task.status === 'running' ||
            task.status === 'pending_approval') && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={isZh ? '取消' : 'Cancel'}
              title={isZh ? '取消' : 'Cancel'}
            >
              <Ban className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 bg-surface/20">
          {task.error && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-400">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{task.error}</span>
            </div>
          )}

          {task.result?.summary && (
            <div className="text-[11px] text-text-primary">
              <span className="text-text-muted">{isZh ? '结果：' : 'Result: '}</span>
              {task.result.summary}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div>
              <span className="text-text-muted">{isZh ? '来源' : 'Origin'}</span>
              <span className="ml-1.5 text-text-primary">{task.origin}</span>
            </div>
            <div>
              <span className="text-text-muted">{isZh ? '耗时' : 'Duration'}</span>
              <span className="ml-1.5 text-text-primary">
                {formatDuration(task.createdAt, task.finishedAt)}
              </span>
            </div>
            {task.originId && (
              <div className="col-span-2 truncate">
                <span className="text-text-muted">{isZh ? '规则' : 'Rule'}</span>
                <span className="ml-1.5 text-text-primary">{task.originId}</span>
              </div>
            )}
          </div>

          {task.trace.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-text-muted mb-1">
                {isZh ? '执行轨迹' : 'Trace'}
              </div>
              <ol className="space-y-0.5 max-h-40 overflow-y-auto">
                {task.trace.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="text-[11px] text-text-muted flex gap-1.5">
                    <span className="shrink-0 opacity-60">{new Date(entry.at).toLocaleTimeString()}</span>
                    <span className="shrink-0 text-text-primary/70">[{entry.actor}]</span>
                    <span className="break-all">{entry.message}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function LedgerExplorer() {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [tasks, setTasks] = useState<LedgerTaskView[]>([])
  const [settings, setSettings] = useState<AutomationSettingsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const ledger = window.electronAPI?.trigger

  const loadAll = useCallback(async () => {
    if (!ledger) {
      setError(isZh ? '任务账本 API 不可用' : 'Ledger API unavailable')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [listRes, settingsRes] = await Promise.all([
        ledger.listLedgerTasks({ limit: 100 }),
        ledger.getTriggerSettings(),
      ])
      if (listRes?.success) {
        setTasks(listRes.data ?? [])
      } else {
        setError(listRes?.error ?? (isZh ? '任务加载失败' : 'Failed to load tasks'))
      }
      if (settingsRes?.success && settingsRes.data) {
        setSettings(settingsRes.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [ledger, isZh])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // 增量同步：主进程在创建与每次状态迁移时都会广播同一条频道
  useEffect(() => {
    if (!ledger?.onLedgerTaskUpdated) return
    const unsubscribe = ledger.onLedgerTaskUpdated((updated: LedgerTaskView) => {
      setTasks((prev) => {
        const index = prev.findIndex((t) => t.id === updated.id)
        if (index === -1) return [updated, ...prev]
        const next = prev.slice()
        next[index] = updated
        return next
      })
    })
    return unsubscribe
  }, [ledger])

  const handleSettingChange = useCallback(
    async (patch: Partial<AutomationSettingsView>) => {
      if (!ledger) return
      setSavingSettings(true)
      setActionError(null)
      try {
        const res = await ledger.updateTriggerSettings(patch)
        if (res?.success && res.data) {
          setSettings(res.data)
        } else {
          setActionError(res?.error ?? (isZh ? '开关保存失败' : 'Failed to save setting'))
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingSettings(false)
      }
    },
    [ledger, isZh],
  )

  /** 统一包装单任务操作：去重、错误冒泡、忙状态 */
  const runAction = useCallback(
    async (taskId: string, action: () => Promise<{ success?: boolean; error?: string } | undefined>) => {
      if (busyId) return
      setBusyId(taskId)
      setActionError(null)
      try {
        const res = await action()
        if (res && res.success === false) {
          setActionError(res.error ?? (isZh ? '操作失败' : 'Action failed'))
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyId(null)
      }
    },
    [busyId, isZh],
  )

  const counts = useMemo(() => {
    const base: Record<TaskStatus, number> = {
      pending_approval: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    }
    for (const task of tasks) base[task.status]++
    return base
  }, [tasks])

  const activeCount = counts.pending_approval + counts.queued + counts.running

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/40 shrink-0">
        <Activity className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-text-primary">
            {isZh ? '任务中心' : 'Task Center'}
          </h2>
          <p className="text-[11px] text-text-muted">
            {isZh
              ? `共 ${tasks.length} 条 · ${activeCount} 条进行中`
              : `${tasks.length} total · ${activeCount} active`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          aria-label={isZh ? '刷新' : 'Refresh'}
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {settings && (
        <LedgerSettingsBar
          settings={settings}
          onChange={(patch) => void handleSettingChange(patch)}
          saving={savingSettings}
        />
      )}

      {actionError && (
        <div className="flex items-start gap-1.5 px-3 py-2 text-[11px] text-red-400 border-b border-border/40 shrink-0">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{actionError}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span className="text-xs">{isZh ? '加载中…' : 'Loading…'}</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
            <XCircle className="w-6 h-6 text-red-400" aria-hidden="true" />
            <p className="text-xs text-text-muted break-all">{error}</p>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="mt-1 px-2.5 py-1 text-[11px] rounded border border-border/50 text-text-primary hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {isZh ? '重试' : 'Retry'}
            </button>
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
            <Clock className="w-6 h-6 text-text-muted/50" aria-hidden="true" />
            <p className="text-xs text-text-muted">{isZh ? '暂无任务' : 'No tasks yet'}</p>
            <p className="text-[11px] text-text-muted/70 leading-relaxed max-w-xs">
              {settings?.triggersEnabled && settings?.autoCreateTask
                ? isZh
                  ? '正在监听事件，命中后会自动出现在这里。'
                  : 'Watching for events — hits will appear here.'
                : isZh
                  ? '打开上方「监听事件」与「自动建任务」后，事件命中会自动记录到这里。'
                  : 'Enable "Watch events" and "Auto-create tasks" above to start collecting.'}
            </p>
          </div>
        )}

        {!loading && !error && tasks.length > 0 && (
          <ul>
            {tasks.map((task) => (
              <LedgerTaskRow
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                busy={busyId === task.id || isTaskInflight(task.id)}
                onStart={() =>
                  void runAction(task.id, async () => {
                    const outcome = await executeLedgerTask(task)
                    return outcome.ok ? { success: true } : { success: false, error: outcome.reason }
                  })
                }
                onApprove={() =>
                  void runAction(task.id, async () => ledger?.approveLedgerTask(task.id))
                }
                onRetry={() => void runAction(task.id, async () => ledger?.retryLedgerTask(task.id))}
                onCancel={() =>
                  void runAction(task.id, async () => ledger?.cancelLedgerTask(task.id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default LedgerExplorer
