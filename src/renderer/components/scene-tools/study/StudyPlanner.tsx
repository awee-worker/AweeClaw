/**
 * 学习计划表 — 学习模式增强工具
 *
 * 功能：周计划排布（按天+科目+时段）、完成勾选、完成率统计
 */

import { useMemo, useState } from 'react'
import { CalendarRange, Plus, Check, Trash2, Target } from 'lucide-react'
import { usePlanStore, todayStr, uid } from '../stores'

const SUBJECTS = ['数学', '英语', '编程', '阅读', '专业课', '复习', '其他']
const TIME_SLOTS = ['上午', '下午', '晚上']

export default function StudyPlanner() {
  const { items, add, update, remove, reset } = usePlanStore()
  const [weekStart, setWeekStart] = useState<string>(() => {
    const d = new Date()
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [task, setTask] = useState('')
  const [slot, setSlot] = useState('上午')

  const days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]
      return { date: ds, weekday }
    })
  }, [weekStart])

  const weekTasks = useMemo(() => items.filter((t) => days.some((d) => d.date === t.date)), [items, days])
  const doneCount = weekTasks.filter((t) => t.done).length
  const rate = weekTasks.length > 0 ? Math.round((doneCount / weekTasks.length) * 100) : 0

  const today = todayStr()
  const isThisWeek = days.some((d) => d.date === today)

  const handleAdd = (date: string) => {
    if (!task.trim()) return
    add({ date, subject, task: task.trim(), done: false, timeSlot: slot })
    setTask('')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <CalendarRange className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">学习计划表</span>
        <button onClick={reset} className="ml-auto text-[12px] text-text-muted hover:text-red-500 transition-colors">清空</button>
      </div>

      {/* 周选择 + 完成率 */}
      <div className="flex items-center gap-2 mb-3">
        <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}
          className="flex-1 text-[12px] px-2 py-1 rounded-md bg-surface border border-border/50 text-text-muted" />
        <div className="flex items-center gap-1 text-[12px] text-text-muted">
          <Target className="w-3 h-3" /> {doneCount}/{weekTasks.length} · {rate}%
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pb-1">
        {days.map((d) => {
          const dayTasks = weekTasks.filter((t) => t.date === d.date).sort((a, b) => TIME_SLOTS.indexOf(a.timeSlot ?? '') - TIME_SLOTS.indexOf(b.timeSlot ?? ''))
          const isToday = d.date === today
          return (
            <div key={d.date} className={`rounded-xl border ${isToday ? 'border-accent/40 bg-accent/5' : 'border-border/40'}`}>
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className={`text-[12px] font-semibold ${isToday ? 'text-accent' : ''}`}>{d.weekday}</span>
                <span className="text-[12px] text-text-muted">{d.date}</span>
                {isToday && <span className="text-[9px] px-1 py-px rounded bg-accent/10 text-accent">今天</span>}
                <span className="ml-auto text-[12px] text-text-muted">{dayTasks.filter((t) => t.done).length}/{dayTasks.length}</span>
              </div>
              <div className="px-2 pb-2 space-y-1">
                {dayTasks.map((t) => (
                  <div key={t.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md ${t.done ? 'opacity-50' : 'bg-surface/50'}`}>
                    <button onClick={() => update(t.id, { done: !t.done })}
                      className={`flex-shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors ${
                        t.done ? 'bg-accent border-accent text-white' : 'border-border hover:border-accent/60'
                      }`}>
                      {t.done && <Check className="w-2 h-2" />}
                    </button>
                    <span className="text-[12px] text-accent/80 flex-shrink-0 w-8">{t.timeSlot}</span>
                    <span className={`flex-1 text-[12px] truncate ${t.done ? 'line-through text-text-muted' : ''}`}>{t.task}</span>
                    <span className="text-[9px] px-1 py-px rounded bg-accent/10 text-accent flex-shrink-0">{t.subject}</span>
                    <button onClick={() => remove(t.id)} className="opacity-0 hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {isThisWeek && (
                  <div className="flex gap-1.5 items-center">
                    <select value={subject} onChange={(e) => setSubject(e.target.value)}
                      className="text-[12px] px-1 py-0.5 rounded bg-background border border-border/50 text-text-muted w-14 flex-shrink-0">
                      {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={slot} onChange={(e) => setSlot(e.target.value)}
                      className="text-[12px] px-1 py-0.5 rounded bg-background border border-border/50 text-text-muted w-12 flex-shrink-0">
                      {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input
                      value={task} onChange={(e) => setTask(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd(d.date)}
                      placeholder={isToday ? `添加 ${d.weekday} 计划…` : '计划…'}
                      className="flex-1 text-[12px] px-2 py-1 rounded-md bg-background border border-border/50 focus:outline-none"
                    />
                    <button onClick={() => handleAdd(d.date)} className="px-1.5 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
