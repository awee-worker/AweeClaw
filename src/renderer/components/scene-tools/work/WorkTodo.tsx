/**
 * 待办清单 — 工作模式核心工具
 *
 * 功能：新增任务、优先级、截止日期、完成状态、过滤、统计
 */

import { useMemo, useState } from 'react'
import { Plus, Check, Circle, Trash2, Flag, CalendarDays, ListTodo } from 'lucide-react'
import { useTodoStore, todayStr, type WorkTodoItem } from '../stores'

const PRIORITY_META: Record<string, { label: string; cls: string; dot: string }> = {
  high: { label: '高', cls: 'bg-red-500/10 text-red-500 border-red-500/30', dot: 'bg-red-500' },
  medium: { label: '中', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30', dot: 'bg-amber-500' },
  low: { label: '低', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/30', dot: 'bg-sky-500' },
}

type Filter = 'all' | 'active' | 'done'

export default function WorkTodo() {
  const { items, add, update, remove } = useTodoStore()
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const activeCount = items.filter((i) => !i.done).length
  const doneCount = items.length - activeCount

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const p = { high: 0, medium: 1, low: 2 }
      return p[a.priority] - p[b.priority]
    })
    if (filter === 'active') return sorted.filter((i) => !i.done)
    if (filter === 'done') return sorted.filter((i) => i.done)
    return sorted
  }, [items, filter])

  const handleAdd = () => {
    if (!text.trim()) return
    add({ text: text.trim(), done: false, priority, dueDate: dueDate || undefined })
    setText('')
    setDueDate('')
  }

  const isOverdue = (i: WorkTodoItem) => i.dueDate && !i.done && i.dueDate < todayStr()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 统计头 */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <ListTodo className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">待办清单</span>
        <span className="text-[11px] text-text-muted">
          {activeCount} 进行中 · {doneCount} 已完成
        </span>
      </div>

      {/* 新增 */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="添加一个任务…"
            className="flex-1 min-w-0 text-[12px] px-2.5 py-1.5 rounded-lg bg-surface border border-border/60 focus:outline-none focus:border-accent/60 placeholder:text-text-muted/60"
          />
          <button
            onClick={handleAdd}
            className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> 添加
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['high', 'medium', 'low'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`px-2 py-0.5 rounded-md text-[11px] border flex items-center gap-1 transition-colors ${
                  priority === p ? PRIORITY_META[p].cls : 'border-border/50 text-text-muted hover:border-border'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_META[p].dot}`} />
                {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="text-[11px] px-2 py-0.5 rounded-md bg-surface border border-border/50 text-text-muted focus:outline-none"
          />
        </div>
      </div>

      {/* 过滤 */}
      <div className="flex gap-1 mb-2">
        {(['all', 'active', 'done'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
              filter === f ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {f === 'all' ? '全部' : f === 'active' ? '进行中' : '已完成'}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 pb-1">
        {filtered.length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">
            {items.length === 0 ? '暂无任务，添加第一个吧' : '当前筛选下没有任务'}
          </div>
        )}
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`group flex items-start gap-2 px-2 py-1.5 rounded-lg border border-transparent hover:border-border/60 hover:bg-surface/60 transition-colors ${
              item.done ? 'opacity-50' : ''
            }`}
          >
            <button
              onClick={() => update(item.id, { done: !item.done })}
              className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                item.done ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent/60'
              }`}
            >
              {item.done && <Check className="w-2.5 h-2.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-[12px] leading-snug break-words ${item.done ? 'line-through text-text-muted' : ''}`}>
                {item.text}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded border ${PRIORITY_META[item.priority].cls}`}>
                  <Flag className="w-2.5 h-2.5" /> {PRIORITY_META[item.priority].label}
                </span>
                {item.dueDate && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] text-text-muted ${isOverdue(item) ? 'text-red-500' : ''}`}>
                    <CalendarDays className="w-2.5 h-2.5" />
                    {item.dueDate}
                    {isOverdue(item) && ' 已逾期'}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => remove(item.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-500 flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
