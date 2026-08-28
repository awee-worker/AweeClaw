/**
 * 工作计划工具 — 工作模式核心工具
 *
 * 功能：周计划、月计划、日计划管理；日期到期提醒；优先级；完成追踪
 */

import { useMemo, useState, useEffect } from 'react'
import {
  Plus, Trash2, Calendar, CheckCircle2, Circle, Clock,
  ChevronLeft, ChevronRight, Flag, AlertCircle,
} from 'lucide-react'
import { useWorkPlanStore, type WorkPlanItem, type WorkPlanEntry, todayStr } from '../stores'

type PlanType = 'week' | 'month' | 'day'

const PRIORITY_META: Record<string, { label: string; cls: string; dot: string }> = {
  high: { label: '高', cls: 'bg-red-500/10 text-red-500 border-red-500/30', dot: 'bg-red-500' },
  medium: { label: '中', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30', dot: 'bg-amber-500' },
  low: { label: '低', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/30', dot: 'bg-sky-500' },
}

function getWeekStart(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`
}

function getWeekDates(baseDate: string): string[] {
  const d = new Date(baseDate)
  const start = getWeekStart(d)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start)
    day.setDate(day.getDate() + i)
    return formatDate(day)
  })
}

function getMonthDates(baseDate: string): string[] {
  const d = new Date(baseDate)
  const year = d.getFullYear()
  const month = d.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => formatDate(new Date(year, month, i + 1)))
}

export default function WorkPlan() {
  const { items, add, update, remove } = useWorkPlanStore()
  const [activePlanId, setActivePlanId] = useState<string | null>(
    () => items.find((p) => p.remindedDates?.includes(todayStr()))?.id ?? items[0]?.id ?? null
  )

  // 当 planType 为 week/month 但 entries 为空时，自动生成默认日期条目
  useEffect(() => {
    items.forEach((plan) => {
      if (plan.entries.length === 0 && (plan.planType === 'week' || plan.planType === 'month')) {
        const dates = plan.planType === 'week'
          ? getWeekDates(plan.baseDate)
          : getMonthDates(plan.baseDate)
        const filteredDates = plan.planType === 'month'
          ? dates.filter((d) => { const day = new Date(d).getDay(); return day !== 0 && day !== 6 })
          : dates
        const newEntries = filteredDates.map((date) => ({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date,
          task: '',
          priority: 'medium' as const,
          done: false,
        }))
        if (newEntries.length > 0) update(plan.id, { entries: newEntries })
      }
    })
  }, [items])
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState<PlanType>('week')
  const [createTitle, setCreateTitle] = useState('')
  const [notifyEnabled, setNotifyEnabled] = useState(true)

  // 每日提醒检查
  useEffect(() => {
    if (!notifyEnabled || !window.electronAPI?.notificationRequest) return
    const checkReminders = () => {
      const today = todayStr()
      let changed = false
      items.forEach((plan) => {
        if (plan.remindedDates?.includes(today)) return
        const dueToday = plan.entries.some((e) => e.date === today && !e.done)
        if (dueToday) {
          window.electronAPI.notificationRequest({
            title: '工作计划提醒',
            body: `今日有 ${plan.entries.filter((e) => e.date === today && !e.done).length} 项待办`,
          })
          update(plan.id, { remindedDates: [...(plan.remindedDates ?? []), today] })
          changed = true
        }
      })
      if (changed) setTimeout(checkReminders, 1000)
    }
    const timer = setInterval(checkReminders, 60 * 1000)
    return () => clearInterval(timer)
  }, [items, notifyEnabled, update])

  const activePlan = useMemo(() => items.find((p) => p.id === activePlanId), [items, activePlanId])

  const handleCreate = () => {
    if (!createTitle.trim()) return
    const baseDate = new Date()
    let entries: WorkPlanEntry[] = []
    if (createType === 'week') {
      const weekDates = getWeekDates(formatDate(getWeekStart(baseDate)))
      entries = weekDates.map((date) => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date,
        task: '',
        priority: 'medium' as const,
        done: false,
      }))
    } else if (createType === 'month') {
      const monthDates = getMonthDates(formatDate(getMonthStart(baseDate)))
      // 仅取本月工作日
      entries = monthDates.filter((d) => {
        const day = new Date(d).getDay()
        return day !== 0 && day !== 6
      }).map((date) => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date,
        task: '',
        priority: 'medium' as const,
        done: false,
      }))
    } else {
      entries = [{
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: formatDate(baseDate),
        task: '',
        priority: 'medium' as const,
        done: false,
      }]
    }
    const plan: Omit<WorkPlanItem, 'id' | 'createdAt'> = {
      planType: createType,
      title: createTitle.trim(),
      baseDate: formatDate(baseDate),
      entries,
      remindedDates: [],
    }
    add(plan)
    setShowCreate(false)
    setCreateTitle('')
  }

  const handleDelete = (id: string) => {
    remove(id)
    if (activePlanId === id) setActivePlanId(items.find((p) => p.id !== id)?.id ?? null)
  }

  const navigateWeek = (delta: number) => {
    if (!activePlan) return
    const base = new Date(activePlan.baseDate)
    if (activePlan.planType === 'week') {
      base.setDate(base.getDate() + delta * 7)
    } else if (activePlan.planType === 'month') {
      base.setMonth(base.getMonth() + delta)
    }
    update(activePlan.id, { baseDate: formatDate(base) })
  }

  const addEntry = () => {
    if (!activePlan) return
    const today = todayStr()
    const newEntry: WorkPlanEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: today,
      task: '',
      priority: 'medium',
      done: false,
    }
    update(activePlan.id, { entries: [newEntry, ...activePlan.entries] })
  }

  const addEntryToDate = (date: string) => {
    if (!activePlan) return
    const newEntry: WorkPlanEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      task: '',
      priority: 'medium',
      done: false,
    }
    update(activePlan.id, { entries: [...activePlan.entries, newEntry] })
  }

  const toggleDone = (entryId: string) => {
    if (!activePlan) return
    const entry = activePlan.entries.find((e) => e.id === entryId)
    if (!entry) return
    update(activePlan.id, {
      entries: activePlan.entries.map((e) =>
        e.id === entryId ? { ...e, done: !e.done } : e
      ),
    })
  }

  const updateEntry = (entryId: string, patch: Partial<WorkPlanEntry>) => {
    if (!activePlan) return
    update(activePlan.id, {
      entries: activePlan.entries.map((e) =>
        e.id === entryId ? { ...e, ...patch } : e
      ),
    })
  }

  const removeEntry = (entryId: string) => {
    if (!activePlan) return
    update(activePlan.id, { entries: activePlan.entries.filter((e) => e.id !== entryId) })
  }

  const stats = useMemo(() => {
    if (!activePlan) return null
    const total = activePlan.entries.length
    const done = activePlan.entries.filter((e) => e.done).length
    const pending = total - done
    const todayEntries = activePlan.entries.filter((e) => e.date === todayStr())
    const todayDone = todayEntries.filter((e) => e.done).length
    const overdue = activePlan.entries.filter((e) => !e.done && e.date < todayStr())
    return { total, done, pending, todayTotal: todayEntries.length, todayDone, overdueCount: overdue.length }
  }, [activePlan])

  const groupByDate = (entries: WorkPlanEntry[]) => {
    const map = new Map<string, WorkPlanEntry[]>()
    entries.forEach((e) => {
      const arr = map.get(e.date) ?? []
      arr.push(e)
      map.set(e.date, arr)
    })
    return map
  }

  const dateLabel = (dateStr: string) => {
    if (dateStr === todayStr()) return '今天'
    const d = new Date(dateStr)
    const today = new Date(todayStr())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (dateStr === formatDate(tomorrow)) return '明天'
    return formatDisplayDate(dateStr)
  }

  const today = todayStr()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent" />
          <span className="text-[13px] font-semibold">工作计划</span>
          {activePlan && (
            <span className="text-[12px] text-text-muted truncate max-w-[120px]">
              {activePlan.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-[12px] text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
              className="accent-accent w-3 h-3"
            />
            提醒
          </label>
          <button
            onClick={() => setShowCreate(true)}
            className="px-2 py-0.5 rounded-md bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3 h-3" /> 新建
          </button>
        </div>
      </div>

      {/* 计划选择条 */}
      {items.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3 pb-0.5">
          {items.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setActivePlanId(plan.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] transition-all ${
                plan.id === activePlanId
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-surface text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
                <span className="text-[12px] opacity-70">
                {plan.planType === 'week' ? '周' : plan.planType === 'month' ? '月' : '日'}
              </span>
              <span className="truncate max-w-[80px]">{plan.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(plan.id) }}
                className="ml-0.5 opacity-60 hover:opacity-100"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* 主内容区 */}
      {activePlan ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* 导航与统计 */}
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-1">
              <button onClick={() => navigateWeek(-1)} className="p-1 rounded hover:bg-surface-hover">
                <ChevronLeft className="w-3.5 h-3.5 text-text-muted" />
              </button>
              <span className="text-[12px] text-text-muted min-w-[80px] text-center">
                {activePlan.planType === 'week'
                  ? `${activePlan.baseDate} 当周`
                  : activePlan.planType === 'month'
                    ? `${activePlan.baseDate.slice(0, 7)} 当月`
                    : activePlan.baseDate}
              </span>
              <button onClick={() => navigateWeek(1)} className="p-1 rounded hover:bg-surface-hover">
                <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              </button>
            </div>
            {stats && (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                {stats.overdueCount > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500">
                    <AlertCircle className="w-3 h-3" /> {stats.overdueCount} 逾期
                  </span>
                )}
                <span className="flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  {stats.todayDone}/{stats.todayTotal} 今日
                </span>
                <span>{stats.done}/{stats.total} 总</span>
              </div>
            )}
          </div>

          {/* 按日期分组的条目 */}
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pr-0.5">
            {(() => {
              const groups = groupByDate(activePlan.entries)
              const sortedDates = Array.from(groups.keys()).sort()
              return sortedDates.map((date) => {
                const entries = groups.get(date)!
                const isToday = date === today
                return (
                  <div key={date}>
                    <div className={`flex items-center gap-2 mb-1.5 px-1 ${isToday ? 'text-accent font-medium' : 'text-text-muted text-[12px]'}`}>
                      <Calendar className="w-3 h-3" />
                      <span>{dateLabel(date)}</span>
                      <span className="text-[12px] opacity-60">({entries.filter((e) => e.done).length}/{entries.length})</span>
                      <button
                        onClick={() => addEntryToDate(date)}
                        className="ml-auto p-0.5 rounded hover:bg-surface-hover"
                        title="添加条目"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {entries.map((entry) => (
                        <PlanEntryRow
                          key={entry.id}
                          entry={entry}
                          isToday={isToday}
                          onChange={(patch) => updateEntry(entry.id, patch)}
                          onToggle={() => toggleDone(entry.id)}
                          onRemove={() => removeEntry(entry.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })
            })()}

            {/* 添加更多日期（仅周/月计划） */}
            {activePlan.planType !== 'day' && (
              <button
                onClick={addEntry}
                className="w-full py-2 rounded-lg border border-dashed border-border/50 text-[12px] text-text-muted hover:border-accent/40 hover:text-accent transition-colors flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> 添加今日任务
              </button>
            )}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted/60">
          <Calendar className="w-10 h-10 opacity-30" />
          <div className="text-center">
            <div className="text-[13px] text-text-muted mb-1">暂无工作计划</div>
            <div className="text-[12px]">创建周计划、月计划或单日计划开始规划吧</div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> 新建计划
          </button>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[12px] text-text-muted/60">
          请选择一个计划
        </div>
      )}

      {/* 新建计划弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface border border-border/60 rounded-2xl p-5 w-[320px] shadow-xl">
            <h3 className="text-[14px] font-semibold mb-4">新建工作计划</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] text-text-muted mb-1 block">计划标题</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="如：本周工作计划"
                  className="w-full text-[12px] px-2.5 py-1.5 rounded-lg bg-surface-input border border-border/60 focus:outline-none focus:border-accent/60 placeholder:text-text-muted/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[12px] text-text-muted mb-1.5 block">计划类型</label>
                <div className="flex gap-2">
                  {(['week', 'month', 'day'] as PlanType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setCreateType(t)}
                      className={`flex-1 py-1.5 rounded-lg text-[12px] border transition-colors ${
                        createType === t
                          ? 'bg-accent/10 border-accent/40 text-accent'
                          : 'border-border/50 text-text-muted hover:border-border'
                      }`}
                    >
                      {t === 'week' ? '周计划' : t === 'month' ? '月计划' : '日计划'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-1.5 rounded-lg text-[12px] border border-border/50 text-text-muted hover:bg-surface-hover transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!createTitle.trim()}
                  className="flex-1 py-1.5 rounded-lg text-[12px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 单行条目组件 */
function PlanEntryRow({
  entry,
  isToday,
  onChange,
  onToggle,
  onRemove,
}: {
  entry: WorkPlanEntry
  isToday: boolean
  onChange: (patch: Partial<WorkPlanEntry>) => void
  onToggle: () => void
  onRemove: () => void
}) {
  const isOverdue = !entry.done && entry.date < todayStr()
  return (
    <div className={`group flex items-start gap-1.5 px-2 py-1.5 rounded-lg border border-transparent hover:border-border/60 hover:bg-surface/60 transition-colors ${
      entry.done ? 'opacity-50' : isOverdue ? 'border-red-500/20 bg-red-500/5' : ''
    }`}>
      <button
        onClick={onToggle}
        className="mt-0.5 flex-shrink-0"
      >
        {entry.done ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Circle className="w-3.5 h-3.5 text-text-muted/40" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <input
          value={entry.task}
          onChange={(e) => onChange({ task: e.target.value })}
          placeholder="输入任务…"
          className={`w-full text-[12px] bg-transparent focus:outline-none ${
            entry.done ? 'line-through opacity-50' : ''
          }`}
        />
        <div className="flex items-center gap-2 mt-0.5">
          <select
            value={entry.priority}
            onChange={(e) => onChange({ priority: e.target.value as WorkPlanEntry['priority'] })}
            className="text-[12px] bg-transparent border border-border/30 rounded px-1 py-0.5 focus:outline-none text-text-muted"
          >
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <input
            type="date"
            value={entry.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className="text-[12px] bg-transparent border border-border/30 rounded px-1 py-0.5 focus:outline-none text-text-muted"
          />
          {entry.estimatedMin && (
              <span className="flex items-center gap-0.5 text-[12px] text-text-muted/60">
              <Clock className="w-2.5 h-2.5" /> {entry.estimatedMin}min
            </span>
          )}
          <button
            onClick={() => onChange({ estimatedMin: entry.estimatedMin ? undefined : 30 })}
            className="opacity-0 group-hover:opacity-100 text-[12px] text-text-muted/60 hover:text-accent transition-opacity"
          >
            加时间
          </button>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-all flex-shrink-0"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )
}
