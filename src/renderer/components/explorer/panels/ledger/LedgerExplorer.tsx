/**
 * 任务中心 — 事件触发的本地任务账本
 *
 * 数据源：主进程 TaskLedger（纯本地，不依赖后端登录）
 * 与 ScheduleExplorer 的区别：那边是「定时到点执行」，这边是「事件发生后的任务记录」。
 *
 * 以全屏抽屉呈现（由 PanelDrawerHost 承载，宽度 full），因此布局按宽屏设计，三栏分布：
 *
 *   LedgerExplorer      容器：拉数据、订阅增量、持有筛选与选中态
 *   ├ 概览卡            进行中 / 待审批 / 已完成 / 失败 / 平均耗时
 *   ├ LedgerSidePanel   左栏：搜索、状态与来源筛选、近 7 天活动、自动化开关
 *   ├ LedgerTaskList    中栏：任务行（状态、标题、来源、时间、行内操作）
 *   └ LedgerTaskDetail  右栏：元信息、进度、结果产物、错误与执行轨迹
 *
 * 窄屏（<1280）下左栏隐藏，详情改为覆盖层，列表仍保持单栏可读。
 *
 * @module explorer/panels/ledger/LedgerExplorer
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDownWideNarrow,
  Clock,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useStore } from '@store'
import type { AutomationSettingsView, LedgerTaskView } from '@renderer/types/electronBridge'
import { executeLedgerTask, isTaskInflight } from '@components/intelligence/proactive/ledgerTaskExecutor'
import { LedgerSidePanel } from './LedgerSidePanel'
import { LedgerTaskList, type SortKey } from './LedgerTaskList'
import { LedgerTaskDetail } from './LedgerTaskDetail'
import { STATUS_META, formatDuration, taskDuration } from './ledgerMeta'
import type { TaskOrigin, TaskStatus } from './ledgerMeta'

const EMPTY_COUNTS: Record<TaskStatus, number> = {
  pending_approval: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
}

/** 概览卡：数值 + 标签，颜色由调用方给，避免在这里再写一遍状态色 */
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: typeof Clock
  label: string
  value: string | number
  tone: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-surface/30 px-3 py-2.5 min-w-0">
      <div className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-text-primary tabular-nums leading-none">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-text-muted/70 truncate">{hint}</div>}
    </div>
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
  const [actionError, setActionError] = useState<string | null>(null)

  // 视图态
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [originFilter, setOriginFilter] = useState<TaskOrigin | 'all'>('all')
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

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
        ledger.listLedgerTasks({ limit: 200 }),
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
    const base: Record<TaskStatus, number> = { ...EMPTY_COUNTS }
    for (const task of tasks) base[task.status]++
    return base
  }, [tasks])

  const stats = useMemo(() => {
    const active = counts.running + counts.pending_approval + counts.queued
    const durations = tasks
      .filter((task) => task.finishedAt && task.finishedAt > 0)
      .map((task) => taskDuration(task))
      .filter((value): value is number => value !== null && value >= 0)
    const average = durations.length > 0
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const completedToday = tasks.filter(
      (task) => task.status === 'completed' && (task.finishedAt ?? 0) >= today.getTime(),
    ).length
    return { active, average, completedToday, total: tasks.length }
  }, [tasks, counts])

  /** 排序 + 过滤一次算完，避免列表与详情各算一遍出现口径差异 */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = tasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (originFilter !== 'all' && task.origin !== originFilter) return false
      if (!keyword) return true
      return [task.title, task.kind, task.origin, task.error ?? '', task.result?.summary ?? '']
        .some((field) => String(field).toLowerCase().includes(keyword))
    })

    const sorted = list.slice()
    sorted.sort((a, b) => {
      if (sortBy === 'oldest') return a.createdAt - b.createdAt
      if (sortBy === 'duration') {
        const aDur = a.status === 'running' ? Date.now() - a.createdAt : (taskDuration(a) ?? -1)
        const bDur = b.status === 'running' ? Date.now() - b.createdAt : (taskDuration(b) ?? -1)
        return bDur - aDur
      }
      return b.createdAt - a.createdAt
    })
    return sorted
  }, [tasks, query, statusFilter, originFilter, sortBy])

  /**
   * 详情对象
   *
   * 传了 selectedId 就优先它；筛选把选中项滤掉时回落到列表首条，
   * 这样宽屏右栏不会空着，也不会出现「列表高亮 A、详情显示 B」。
   */
  const selectedTask = useMemo(() => {
    if (selectedId) {
      const hit = filtered.find((task) => task.id === selectedId)
      if (hit) return hit
    }
    return filtered[0] ?? null
  }, [filtered, selectedId])

  const handleSelect = useCallback((taskId: string) => {
    setSelectedId(taskId)
    setDetailOpen(true)
  }, [])

  const hasFilter = statusFilter !== 'all' || originFilter !== 'all' || query.trim().length > 0

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-background text-text-primary overflow-hidden">
      {/* 头部 */}
      <header className="shrink-0 px-5 py-3 border-b border-border/30 flex items-center gap-3">
        <Activity className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-text-primary leading-tight">
            {isZh ? '任务中心' : 'Task Center'}
          </h1>
          <p className="text-[11px] text-text-muted mt-0.5">
            {isZh
              ? `共 ${stats.total} 条记录 · ${stats.active} 条进行中 · 今日完成 ${stats.completedToday} 条`
              : `${stats.total} records · ${stats.active} active · ${stats.completedToday} done today`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-text-muted">
            {/* 实时订阅的视觉提示：主进程每发生一次状态迁移都会推到这里 */}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" aria-hidden="true" />
            {isZh ? '实时同步' : 'Live'}
          </span>
          <label className="inline-flex items-center gap-1 text-[11px] text-text-muted">
            <ArrowDownWideNarrow className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">{isZh ? '排序方式' : 'Sort by'}</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortKey)}
              className="bg-surface/60 border border-border/50 rounded-md px-1.5 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent/60"
            >
              <option value="recent">{isZh ? '最新优先' : 'Newest'}</option>
              <option value="oldest">{isZh ? '最早优先' : 'Oldest'}</option>
              <option value="duration">{isZh ? '耗时最长' : 'Longest'}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            aria-label={isZh ? '刷新' : 'Refresh'}
            title={isZh ? '刷新' : 'Refresh'}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* 概览卡 */}
      <div className="shrink-0 px-5 py-3 border-b border-border/20 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <StatCard
          icon={Loader2}
          label={isZh ? '进行中' : 'Active'}
          value={stats.active}
          tone="text-blue-400"
          hint={isZh ? `执行 ${counts.running} · 等待 ${counts.queued}` : `${counts.running} running · ${counts.queued} queued`}
        />
        <StatCard
          icon={STATUS_META.pending_approval.icon}
          label={isZh ? '待审批' : 'Pending approval'}
          value={counts.pending_approval}
          tone="text-amber-400"
          hint={isZh ? '需要人工放行' : 'Needs a manual approval'}
        />
        <StatCard
          icon={STATUS_META.completed.icon}
          label={isZh ? '已完成' : 'Completed'}
          value={counts.completed}
          tone="text-emerald-400"
          hint={isZh ? `今日 ${stats.completedToday}` : `${stats.completedToday} today`}
        />
        <StatCard
          icon={XCircle}
          label={isZh ? '失败 / 取消' : 'Failed / cancelled'}
          value={counts.failed + counts.cancelled}
          tone="text-red-400"
          hint={isZh ? `失败 ${counts.failed}` : `${counts.failed} failed`}
        />
        <StatCard
          icon={Clock}
          label={isZh ? '平均耗时' : 'Avg duration'}
          value={stats.average === null ? '-' : formatDuration(0, stats.average)}
          tone="text-text-secondary"
          hint={isZh ? '按已结束任务统计' : 'Across finished tasks'}
        />
      </div>

      {actionError && (
        <div className="shrink-0 flex items-start gap-1.5 px-5 py-2 text-[11px] text-red-500 border-b border-border/30 bg-red-400/5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-all flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          >
            {isZh ? '忽略' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* 主体：左筛选 + 中列表 + 右详情 */}
      <div className="relative flex-1 min-h-0 flex">
        <LedgerSidePanel
          tasks={tasks}
          counts={counts}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          originFilter={originFilter}
          onOriginFilterChange={setOriginFilter}
          settings={settings}
          savingSettings={savingSettings}
          onSettingChange={(patch) => void handleSettingChange(patch)}
          isZh={isZh}
        />

        {/* 中栏 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 h-9 px-4 flex items-center gap-2 border-b border-border/25 text-[11px] text-text-muted">
            <span>
              {isZh
                ? `${filtered.length} 条任务${hasFilter ? `（共 ${tasks.length} 条）` : ''}`
                : `${filtered.length} tasks${hasFilter ? ` of ${tasks.length}` : ''}`}
            </span>
            {hasFilter && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setStatusFilter('all')
                  setOriginFilter('all')
                }}
                className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
              >
                {isZh ? '清除筛选' : 'Clear filters'}
              </button>
            )}
            {/* 窄屏下没有左栏，搜索框移到这里 */}
            <span className="ml-auto lg:hidden flex items-center">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isZh ? '搜索…' : 'Search…'}
                aria-label={isZh ? '搜索任务' : 'Search tasks'}
                className="w-36 text-[11px] px-2 py-1 rounded-md bg-surface/60 border border-border/50 focus:outline-none focus:border-accent/60"
              />
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-16 text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span className="text-[12px]">{isZh ? '加载中…' : 'Loading…'}</span>
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center gap-2 py-16 px-6 text-center">
                <XCircle className="w-6 h-6 text-red-400" aria-hidden="true" />
                <p className="text-[12px] text-text-secondary break-all max-w-md">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadAll()}
                  className="mt-1 px-2.5 py-1 text-[11px] rounded-md border border-border/60 text-text-primary hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {isZh ? '重试' : 'Retry'}
                </button>
              </div>
            )}

            {/* 空账本：还没产生任何记录，引导去开启监听，而不是只说「暂无」 */}
            {!loading && !error && tasks.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 px-6 text-center">
                <div className="w-11 h-11 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />
                </div>
                <p className="text-[13px] text-text-primary">{isZh ? '任务账本还是空的' : 'The ledger is empty'}</p>
                <p className="text-[11px] text-text-muted leading-relaxed max-w-md">
                  {settings?.triggersEnabled && settings?.autoCreateTask
                    ? isZh
                      ? '已在监听事件，命中后会自动出现在这里；也可以先在会话里让 Agent 跑一个任务。'
                      : 'Event watching is on — hits will show up here, or run a task from the chat first.'
                    : isZh
                      ? '在左下角打开「监听事件」与「自动建任务」后，文件变更、工具调用等事件命中都会记录到这里。'
                      : 'Turn on "Watch events" and "Auto-create tasks" in the left panel to start collecting.'}
                </p>
              </div>
            )}

            {!loading && !error && tasks.length > 0 && (
              <LedgerTaskList
                tasks={filtered}
                selectedId={selectedTask?.id ?? null}
                busyId={busyId}
                isInflight={isTaskInflight}
                isZh={isZh}
                onSelect={handleSelect}
                onStart={(task) =>
                  void runAction(task.id, async () => {
                    const outcome = await executeLedgerTask(task)
                    return outcome.ok ? { success: true } : { success: false, error: outcome.reason }
                  })
                }
                onApprove={(task) => void runAction(task.id, async () => ledger?.approveLedgerTask(task.id))}
                onRetry={(task) => void runAction(task.id, async () => ledger?.retryLedgerTask(task.id))}
                onCancel={(task) => void runAction(task.id, async () => ledger?.cancelLedgerTask(task.id))}
              />
            )}
          </div>
        </div>

        {/* 右栏：xl 以上常驻；窄屏切换为覆盖层 */}
        <aside
          className={`shrink-0 flex flex-col bg-background min-h-0 ${
            detailOpen ? 'flex' : 'max-xl:hidden'
          } max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-20 max-xl:w-full max-xl:max-w-md max-xl:border-l max-xl:border-border/40 max-xl:shadow-2xl xl:relative xl:flex xl:w-[400px] xl:border-l xl:border-border/30`}
          aria-label={isZh ? '任务详情' : 'Task detail'}
        >
          <div className="xl:hidden shrink-0 h-9 px-3 flex items-center justify-between border-b border-border/30">
            <span className="text-[11px] text-text-muted">{isZh ? '任务详情' : 'Task detail'}</span>
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="px-2 py-0.5 text-[11px] rounded-md border border-border/60 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {isZh ? '返回列表' : 'Back'}
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <LedgerTaskDetail
              task={selectedTask}
              busy={busyId === selectedTask?.id}
              isZh={isZh}
              onClose={() => setDetailOpen(false)}
              onStart={(task) =>
                void runAction(task.id, async () => {
                  const outcome = await executeLedgerTask(task)
                  return outcome.ok ? { success: true } : { success: false, error: outcome.reason }
                })
              }
              onApprove={(task) => void runAction(task.id, async () => ledger?.approveLedgerTask(task.id))}
              onRetry={(task) => void runAction(task.id, async () => ledger?.retryLedgerTask(task.id))}
              onCancel={(task) => void runAction(task.id, async () => ledger?.cancelLedgerTask(task.id))}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

export default LedgerExplorer
