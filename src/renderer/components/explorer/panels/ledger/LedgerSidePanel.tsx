/**
 * 任务中心 — 筛选与自动化设置侧栏
 *
 * 全屏抽屉把横向空间让出来了，但列表本身只有五六列信息，
 * 全部铺满会把标题与时间拉得太远。这里把「筛选条件、近期活动、自动化开关」
 * 收进一条固定宽度的左栏：宽屏下始终可见，窄屏随抽屉宽度折叠。
 *
 * @module explorer/panels/ledger/LedgerSidePanel
 */

import { Activity, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import type { AutomationSettingsView, LedgerTaskView } from '@renderer/types/electronBridge'
import { ACTIVE_STATUSES, ORIGIN_META, ORIGIN_ORDER, STATUS_META, STATUS_ORDER } from './ledgerMeta'
import type { TaskOrigin, TaskStatus } from './ledgerMeta'

export interface LedgerSidePanelProps {
  tasks: LedgerTaskView[]
  counts: Record<TaskStatus, number>
  query: string
  onQueryChange: (next: string) => void
  statusFilter: TaskStatus | 'all'
  onStatusFilterChange: (next: TaskStatus | 'all') => void
  originFilter: TaskOrigin | 'all'
  onOriginFilterChange: (next: TaskOrigin | 'all') => void
  settings: AutomationSettingsView | null
  savingSettings: boolean
  onSettingChange: (patch: Partial<AutomationSettingsView>) => void
  isZh: boolean
}

/** 通用开关，避免三处各写一遍 aria 与焦点样式 */
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
    <div className="flex items-start justify-between gap-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-text-primary">{label}</div>
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
          checked
            ? 'bg-accent hover:bg-accent-hover'
            : 'bg-text-muted/35 hover:bg-text-muted/50'
        }`}
      >
        {/*
          轨道 36px、圆点 16px，两侧各留 2px：
          关闭态 left 2px（translate 0），开启态平移 16px → 右边缘距 2px，两端对称。
          位移量必须写死：用 translate-x-4 + translate-x-0.5 会让关闭态落在 4px 处，
          圆点看着偏右、贴不到左边。
        */}
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[16px]' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

/** 近 7 天任务量：用纯 CSS 柱条表达节奏，不引图表库 */
function ActivitySpark({ tasks, isZh }: { tasks: LedgerTaskView[]; isZh: boolean }) {
  const buckets = (() => {
    const days = 7
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = today.getTime() - (days - 1) * 86_400_000
    const list = Array.from({ length: days }, (_, index) => ({
      label: isZh ? `${index + 1}` : `${index + 1}`,
      date: new Date(start + index * 86_400_000),
      count: 0,
    }))
    for (const task of tasks) {
      if (task.createdAt < start) continue
      const index = Math.floor((task.createdAt - start) / 86_400_000)
      if (index >= 0 && index < days) list[index].count += 1
    }
    return list
  })()

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
          <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          {isZh ? '近 7 天任务量' : 'Last 7 days'}
        </h3>
        <span className="text-[11px] text-text-muted tabular-nums">
          {buckets.reduce((sum, bucket) => sum + bucket.count, 0)}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-1 h-14" role="img" aria-label={isZh ? '近 7 天任务量柱状图' : 'Tasks created in the last 7 days'}>
        {buckets.map((bucket, index) => {
          const ratio = bucket.count / max
          return (
            <div key={index} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <div
                className={`w-full rounded-sm transition-all ${
                  bucket.count > 0 ? 'bg-accent/60' : 'bg-border/40'
                }`}
                style={{ height: `${Math.max(3, ratio * 100)}%` }}
                title={`${bucket.date.toLocaleDateString()} · ${bucket.count}`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted/60">
        <span>{buckets[0].date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>
        <span>{isZh ? '今天' : 'Today'}</span>
      </div>
    </div>
  )
}

export function LedgerSidePanel({
  tasks,
  counts,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  originFilter,
  onOriginFilterChange,
  settings,
  savingSettings,
  onSettingChange,
  isZh,
}: LedgerSidePanelProps) {
  const activeCount = ACTIVE_STATUSES.reduce((sum, status) => sum + counts[status], 0)
  const originCounts = (() => {
    const base: Record<string, number> = {}
    for (const task of tasks) base[task.origin] = (base[task.origin] ?? 0) + 1
    return base
  })()

  return (
    <aside
      className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-border/30 overflow-y-auto"
      aria-label={isZh ? '任务筛选' : 'Task filters'}
    >
      {/* 搜索 */}
      <div className="px-3 pt-3 pb-2">
        <label className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-text-muted pointer-events-none" aria-hidden="true" />
          <span className="sr-only">{isZh ? '搜索任务' : 'Search tasks'}</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={isZh ? '搜索标题、类型或错误…' : 'Search title, kind or error…'}
            className="w-full text-[12px] pl-8 pr-7 py-1.5 rounded-lg bg-surface/60 border border-border/50 text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/60 focus:bg-surface"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label={isZh ? '清空搜索' : 'Clear search'}
              className="absolute right-1.5 p-0.5 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </label>
      </div>

      {/* 状态筛选 */}
      <div className="px-3 py-2 border-t border-border/20">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted mb-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          {isZh ? '按状态' : 'By status'}
        </h3>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => onStatusFilterChange('all')}
            aria-pressed={statusFilter === 'all'}
            className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              statusFilter === 'all' ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface/50'
            }`}
          >
            <span>{isZh ? '全部任务' : 'All tasks'}</span>
            <span className="tabular-nums text-[11px] opacity-70">{tasks.length}</span>
          </button>
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status]
            const active = statusFilter === status
            return (
              <button
                key={status}
                type="button"
                onClick={() => onStatusFilterChange(active ? 'all' : status)}
                aria-pressed={active}
                className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  active ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface/50'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
                  <span className="truncate">{isZh ? meta.labelZh : meta.label}</span>
                </span>
                <span className="tabular-nums text-[11px] opacity-70">{counts[status]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 来源筛选 */}
      <div className="px-3 py-2 border-t border-border/20">
        <h3 className="text-[11px] font-medium text-text-muted mb-1.5">{isZh ? '按来源' : 'By origin'}</h3>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onOriginFilterChange('all')}
            aria-pressed={originFilter === 'all'}
            className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              originFilter === 'all'
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border/50 text-text-muted hover:text-text-primary'
            }`}
          >
            {isZh ? '全部' : 'All'}
          </button>
          {ORIGIN_ORDER.map((origin) => {
            const meta = ORIGIN_META[origin]
            const Icon = meta.icon
            const count = originCounts[origin] ?? 0
            const active = originFilter === origin
            return (
              <button
                key={origin}
                type="button"
                onClick={() => onOriginFilterChange(active ? 'all' : origin)}
                aria-pressed={active}
                disabled={count === 0 && !active}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border/50 text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {isZh ? meta.labelZh : meta.label}
                <span className="tabular-nums opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 活动量 */}
      <div className="px-3 py-2 border-t border-border/20">
        <ActivitySpark tasks={tasks} isZh={isZh} />
      </div>

      {/* 自动化开关 */}
      {settings && (
        <div className="px-3 py-2 border-t border-border/20 space-y-2.5">
          <h3 className="flex items-center justify-between text-[11px] font-medium text-text-muted">
            <span>{isZh ? '自动化' : 'Automation'}</span>
            {activeCount > 0 && (
              <span className="text-accent">{isZh ? `${activeCount} 条进行中` : `${activeCount} active`}</span>
            )}
          </h3>
          <ToggleSwitch
            checked={settings.triggersEnabled}
            onChange={(next) => onSettingChange({ triggersEnabled: next })}
            disabled={savingSettings}
            label={isZh ? '监听事件' : 'Watch events'}
            description={
              isZh
                ? '监听文件变更与工具调用事件，关闭后不注册任何事件源，重启生效。'
                : 'Watch file changes and tool calls. Takes effect after restart.'
            }
          />
          <ToggleSwitch
            checked={settings.autoCreateTask}
            onChange={(next) => onSettingChange({ autoCreateTask: next })}
            disabled={savingSettings}
            label={isZh ? '自动建任务' : 'Auto-create tasks'}
            description={
              isZh
                ? '事件命中后自动建一条任务记录，纯本地写入，不产生模型开销。'
                : 'Create a task record on each hit. Local write only, no model cost.'
            }
          />
          <ToggleSwitch
            checked={settings.autoExecuteTask}
            onChange={(next) => onSettingChange({ autoExecuteTask: next })}
            disabled={savingSettings}
            label={isZh ? '自动执行' : 'Auto-execute'}
            description={
              isZh
                ? '建完立即交给 Agent 执行，这是唯一会消耗 token 的开关。'
                : 'Hand the task to the Agent immediately. The only switch that costs tokens.'
            }
          />
        </div>
      )}

      <div className="mt-auto px-3 py-2 border-t border-border/20">
        <p className="text-[10px] text-text-muted/60 leading-relaxed flex items-start gap-1">
          <RotateCcw className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          {isZh
            ? '任务账本保存在本地，最多保留 500 条；重启后仍在。'
            : 'The ledger is local and keeps up to 500 tasks across restarts.'}
        </p>
      </div>
    </aside>
  )
}

export default LedgerSidePanel
