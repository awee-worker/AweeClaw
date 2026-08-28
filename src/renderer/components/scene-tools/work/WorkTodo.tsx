/**
 * 待办清单 — 工作模式核心工具
 *
 * 功能：新增任务、优先级、截止日期、AI 执行、完成状态、过滤、统计
 *
 * 与 AI 深度融合：
 * - 创建任务后可点击「执行」，AI 自动读取任务并执行相关操作
 * - AI 执行完毕后，任务自动标记为 done，并记录 aiNote
 * - 左侧菜单「任务」与会话面板的待办共享同一数据源（useTodoStore）
 */

import { useMemo, useState } from 'react'
import {
  Plus, Check, Trash2, Flag, CalendarDays, ListTodo,
  Loader2, Sparkles, CheckCircle2,
} from 'lucide-react'
import { useTodoStore, todayStr, type WorkTodoItem } from '../stores'

const PRIORITY_META: Record<string, { label: string; cls: string; dot: string }> = {
  high: { label: '高', cls: 'bg-red-500/10 text-red-500 border-red-500/30', dot: 'bg-red-500' },
  medium: { label: '中', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30', dot: 'bg-amber-500' },
  low: { label: '低', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/30', dot: 'bg-sky-500' },
}

/** 安全获取优先级元数据，兼容旧数据无 priority 字段的情况 */
const getPriorityMeta = (priority?: string) =>
  PRIORITY_META[priority as keyof typeof PRIORITY_META] ?? PRIORITY_META.medium

type Filter = 'all' | 'active' | 'done'

/**
 * 向 ChatPanel 发送 prompt，触发 AI 执行任务
 * 同时立即将任务状态设为 executing
 */
function executeTask(item: WorkTodoItem, update: (id: string, patch: Partial<WorkTodoItem>) => void): void {
  // 立即标记执行中
  update(item.id, { status: 'executing' })

  // 发送 prompt 给 AI
  const prompt = `请帮我执行以下任务，完成后告知结果：\n\n${item.text}${item.dueDate ? `\n（截止日期：${item.dueDate}）` : ''}`
  window.dispatchEvent(new CustomEvent('aweeclaw:quick-prompt', { detail: prompt }))
}

export default function WorkTodo() {
  const { items, add, update, remove } = useTodoStore()
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const activeCount = items.filter((i) => i.status !== 'done').length
  const doneCount = items.filter((i) => i.status === 'done').length
  const executingCount = items.filter((i) => i.status === 'executing').length

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1
      if (a.status !== 'done' && b.status === 'done') return -1
      if (a.status === 'executing' && b.status !== 'executing') return -1
      if (a.status !== 'executing' && b.status === 'executing') return 1
      const p: Record<string, number> = { high: 0, medium: 1, low: 2 }
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1)
    })
    if (filter === 'active') return sorted.filter((i) => i.status !== 'done')
    if (filter === 'done') return sorted.filter((i) => i.status === 'done')
    return sorted
  }, [items, filter])

  const handleAdd = () => {
    if (!text.trim()) return
    add({ text: text.trim(), status: 'pending', priority, dueDate: dueDate || undefined })
    setText('')
    setDueDate('')
  }

  const isOverdue = (i: WorkTodoItem) => i.dueDate && i.status !== 'done' && i.dueDate < todayStr()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 统计头 */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <ListTodo className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">待办清单</span>
        <span className="text-[12px] text-text-muted">
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
            placeholder="添加任务，直接按 Enter…"
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
                className={`px-2 py-0.5 rounded-md text-[12px] border flex items-center gap-1 transition-colors ${
                  priority === p ? getPriorityMeta(p).cls : 'border-border/50 text-text-muted hover:border-border'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${getPriorityMeta(p).dot}`} />
                {getPriorityMeta(p).label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="text-[12px] px-2 py-0.5 rounded-md bg-surface border border-border/50 text-text-muted focus:outline-none"
          />
        </div>
      </div>

      {/* 过滤 */}
      <div className="flex gap-1 mb-2">
        {(['all', 'active', 'done'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded-md text-[12px] transition-colors ${
              filter === f ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {f === 'all' ? '全部' : f === 'active' ? `进行中${executingCount > 0 ? ` (${executingCount})` : ''}` : '已完成'}
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
              item.status === 'done' ? 'opacity-50' : item.status === 'executing' ? 'border-accent/30 bg-accent/5' : ''
            }`}
          >
            {/* 完成复选框 */}
            <button
              onClick={() => update(item.id, { status: item.status === 'done' ? 'pending' : 'done', executedAt: item.status === 'done' ? undefined : Date.now() })}
              className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                item.status === 'done' ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent/60'
              }`}
            >
              {item.status === 'done' && <Check className="w-2.5 h-2.5" />}
            </button>

            {/* 内容区 */}
            <div className="flex-1 min-w-0">
              <div className={`text-[12px] leading-snug break-words ${item.status === 'done' ? 'line-through text-text-muted' : ''}`}>
                {item.text}
              </div>

              {/* AI 完成摘要 */}
              {item.aiNote && (
                <div className="mt-0.5 text-[12px] text-emerald-500/80 flex items-center gap-1 leading-snug">
                  <CheckCircle2 className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">{item.aiNote}</span>
                </div>
              )}

              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center gap-0.5 text-[12px] px-1 py-px rounded border ${getPriorityMeta(item.priority).cls}`}>
                  <Flag className="w-2.5 h-2.5" /> {getPriorityMeta(item.priority).label}
                </span>
                {item.dueDate && (
                  <span className={`inline-flex items-center gap-0.5 text-[12px] text-text-muted ${isOverdue(item) ? 'text-red-500' : ''}`}>
                    <CalendarDays className="w-2.5 h-2.5" />
                    {item.dueDate}
                    {isOverdue(item) && ' 已逾期'}
                  </span>
                )}
                {item.status === 'executing' && (
                  <span className="inline-flex items-center gap-0.5 text-[12px] text-accent">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> AI 执行中…
                  </span>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {item.status !== 'done' && item.status !== 'executing' && (
                <button
                  onClick={() => executeTask(item, update)}
                  title="让 AI 执行此任务"
                  className="px-1.5 py-0.5 rounded-md text-[12px] bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors flex items-center gap-0.5"
                >
                  <Sparkles className="w-2.5 h-2.5" /> 执行
                </button>
              )}
              {item.status === 'executing' && (
                <span className="px-1.5 py-0.5 rounded-md text-[12px] text-text-muted flex items-center gap-0.5">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                </span>
              )}
              <button
                onClick={() => remove(item.id)}
                className="p-0.5 rounded-md text-text-muted hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
