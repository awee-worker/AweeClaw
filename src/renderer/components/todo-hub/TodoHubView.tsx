/**
 * TodoHubView — 待办中心（宽屏面板）
 *
 * 统一管理来自会话、挂载任务、邮件、项目任务以及手动创建的待办：
 * - 手动新增待办，并可一键交给 AI 执行
 * - 展示每条待办的来源，点击来源可回到原处继续完成
 * - 完成后自动从「进行中」列表消失，支持手动完成 / 删除 / 取消
 *
 * 数据来源见 todoHubStore / todoHubActions。
 */
import { useMemo, useState } from 'react'
import {
  ListTodo, Plus, Check, Trash2, CalendarDays, Loader2, Sparkles,
  CheckCircle2, RotateCcw, ExternalLink, Inbox,
} from 'lucide-react'
import { useStore } from '@store'
import { useTodoHubStore, type HubTodoItem } from './todoHubStore'
import { TODO_SOURCE_META, executeHubTodo, openTodoSource } from './todoHubActions'

const PRIORITY_META: Record<string, { labelZh: string; labelEn: string; cls: string; dot: string }> = {
  high: { labelZh: '高', labelEn: 'High', cls: 'bg-red-500/10 text-red-500 border-red-500/30', dot: 'bg-red-500' },
  medium: { labelZh: '中', labelEn: 'Medium', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30', dot: 'bg-amber-500' },
  low: { labelZh: '低', labelEn: 'Low', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/30', dot: 'bg-sky-500' },
}

const getPriorityMeta = (p?: string) => PRIORITY_META[p as keyof typeof PRIORITY_META] ?? PRIORITY_META.medium

type Filter = 'active' | 'done' | 'all'

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function TodoHubView() {
  const language = useStore((s) => s.language)
  const zh = language === 'zh'
  const { items, add, remove, complete, restore, clearDone } = useTodoHubStore()

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [filter, setFilter] = useState<Filter>('active')

  const pendingCount = items.filter((i) => i.status !== 'done').length
  const doneCount = items.filter((i) => i.status === 'done').length
  const executingCount = items.filter((i) => i.status === 'executing').length

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const sa = a.status === 'done' ? 2 : a.status === 'executing' ? 0 : 1
      const sb = b.status === 'done' ? 2 : b.status === 'executing' ? 0 : 1
      if (sa !== sb) return sa - sb
      const pa = PRIORITY_ORDER[a.priority] ?? 1
      const pb = PRIORITY_ORDER[b.priority] ?? 1
      if (pa !== pb) return pa - pb
      return b.createdAt - a.createdAt
    })
    let list = sorted
    if (filter === 'active') list = list.filter((i) => i.status !== 'done')
    if (filter === 'done') list = list.filter((i) => i.status === 'done')
    return list
  }, [items, filter])

  const handleAdd = () => {
    if (!title.trim()) return
    add({
      title: title.trim(),
      status: 'pending',
      priority,
      dueDate: dueDate || undefined,
      sourceType: 'manual',
      dedupeKey: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    })
    setTitle('')
    setDueDate('')
  }

  const isOverdue = (i: HubTodoItem) => i.dueDate && i.status !== 'done' && i.dueDate < todayStr()

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-background text-text-primary overflow-hidden">
      {/* 头部 */}
      <div className="shrink-0 px-5 py-3 border-b border-border/30 flex items-center gap-3">
        <ListTodo className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold">{zh ? '待办中心' : 'Todo Hub'}</span>
        <span className="text-[12px] text-text-muted">
          {zh
            ? `${pendingCount} 进行中 · ${doneCount} 已完成`
            : `${pendingCount} active · ${doneCount} done`}
        </span>
        {executingCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            {zh ? `${executingCount} 项 AI 执行中` : `${executingCount} running`}
          </span>
        )}
        {doneCount > 0 && (
          <button
            onClick={clearDone}
            className="ml-auto text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            {zh ? '清除已完成' : 'Clear done'}
          </button>
        )}
      </div>

      {/* 新增 */}
      <div className="shrink-0 px-5 py-3 border-b border-border/20 space-y-2">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={zh ? '添加待办，直接按 Enter…' : 'Add a todo, press Enter…'}
            className="flex-1 min-w-0 text-[13px] px-3 py-2 rounded-lg bg-surface border border-border/60 focus:outline-none focus:border-accent/60 placeholder:text-text-muted/60"
          />
          <button
            onClick={handleAdd}
            className="px-3 py-2 rounded-lg bg-accent text-white text-[13px] flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> {zh ? '添加' : 'Add'}
          </button>
        </div>

        {/* 筛选行：状态筛选与优先级 + 日期同一行，两组之间留较大间距 */}
        <div className="flex items-center gap-x-8 gap-y-2 flex-wrap">
          <div className="flex items-center gap-1">
            {(['active', 'done', 'all'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                  filter === f ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f === 'active' ? (zh ? '进行中' : 'Active') : f === 'done' ? (zh ? '已完成' : 'Done') : (zh ? '全部' : 'All')}
              </button>
            ))}
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
                  {zh ? getPriorityMeta(p).labelZh : getPriorityMeta(p).labelEn}
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
      </div>

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pb-4 space-y-1.5">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted/70 gap-2">
            <Inbox className="w-8 h-8 opacity-40" />
            <span className="text-[12px]">
              {items.length === 0
                ? (zh ? '暂无待办，添加一个或等待任务自动汇入' : 'No todos yet')
                : (zh ? '当前筛选下没有待办' : 'Nothing under this filter')}
            </span>
          </div>
        )}
        {filtered.map((item) => {
          const meta = TODO_SOURCE_META[item.sourceType]
          const pMeta = getPriorityMeta(item.priority)
          const jumpable = item.sourceType !== 'manual'
          return (
            <div
              key={item.id}
              className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                item.status === 'done'
                  ? 'border-border/20 bg-surface/30 opacity-70'
                  : 'border-border/40 hover:border-border/70 hover:bg-surface/50'
              }`}
            >
              {/* 完成勾选 */}
              <button
                onClick={() => (item.status === 'done' ? restore(item.id) : complete(item.id))}
                title={item.status === 'done' ? (zh ? '恢复' : 'Restore') : (zh ? '标记完成' : 'Mark done')}
                className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                  item.status === 'done'
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-border/70 hover:border-accent text-transparent hover:text-accent/40'
                }`}
              >
                <Check className="w-3 h-3" />
              </button>

              {/* 主体 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[13px] ${item.status === 'done' ? 'line-through text-text-muted' : ''}`}>
                    {item.title}
                  </span>
                  {item.status === 'executing' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {zh ? 'AI 执行中' : 'Running'}
                    </span>
                  )}
                </div>

                {item.detail && (
                  <div className="text-[12px] text-text-muted mt-0.5 line-clamp-2">{item.detail}</div>
                )}

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* 来源（可点击跳转） */}
                  <button
                    onClick={() => jumpable && openTodoSource(item)}
                    disabled={!jumpable}
                    className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md transition-colors ${
                      jumpable
                        ? 'hover:bg-accent/10 cursor-pointer'
                        : 'cursor-default'
                    }`}
                    style={{ color: meta.color, background: `${meta.color}1a` }}
                    title={jumpable ? (zh ? '前往来源' : 'Open source') : undefined}
                  >
                    {zh ? meta.labelZh : meta.labelEn}
                    {jumpable && <ExternalLink className="w-2.5 h-2.5" />}
                    {item.sourceLabel && (
                      <span className="max-w-[180px] truncate opacity-80">· {item.sourceLabel}</span>
                    )}
                  </button>

                  <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border ${pMeta.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${pMeta.dot}`} />
                    {zh ? pMeta.labelZh : pMeta.labelEn}
                  </span>

                  {item.dueDate && (
                    <span className={`inline-flex items-center gap-1 text-[11px] ${isOverdue(item) ? 'text-red-500' : 'text-text-muted'}`}>
                      <CalendarDays className="w-3 h-3" />
                      {item.dueDate}
                      {isOverdue(item) && (zh ? ' 已逾期' : ' overdue')}
                    </span>
                  )}

                  {item.aiNote && (
                    <span className="text-[11px] text-text-muted inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      {item.aiNote}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作 */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                {item.status === 'pending' && (
                  <button
                    onClick={() => executeHubTodo(item)}
                    title={zh ? '让 AI 执行' : 'Execute with AI'}
                    className="px-2 py-0.5 rounded-md text-[12px] bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" /> {zh ? '执行' : 'Run'}
                  </button>
                )}
                {item.status === 'done' && (
                  <button
                    onClick={() => restore(item.id)}
                    title={zh ? '恢复' : 'Restore'}
                    className="p-1 rounded-md text-text-muted hover:text-accent transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => remove(item.id)}
                  title={zh ? '删除' : 'Delete'}
                  className="p-1 rounded-md text-text-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 本地日期字符串 YYYY-MM-DD */
function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default TodoHubView
