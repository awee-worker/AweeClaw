/**
 * 错题本 — 学习模式核心工具
 *
 * 功能：错题记录（题目/答案/错因/科目）、待复习状态、重做掌握
 */

import { useMemo, useState } from 'react'
import { BookX, Plus, Trash2, CheckCircle2, RotateCcw, GraduationCap } from 'lucide-react'
import { useMistakeStore } from '../stores'

const SUBJECTS = ['数学', '英语', '编程', '物理', '化学', '其他']

export default function StudyMistakeBook() {
  const { items, add, update, remove } = useMistakeStore()
  const [showForm, setShowForm] = useState(false)
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState<'open' | 'mastered' | 'all'>('open')

  const openCount = items.filter((i) => i.status === 'open').length

  const handleAdd = () => {
    if (!question.trim()) return
    add({ subject, question: question.trim(), answer: answer.trim(), reason: reason.trim() || undefined, status: 'open' })
    setQuestion('')
    setAnswer('')
    setReason('')
    setShowForm(false)
  }

  const filtered = useMemo(() => {
    return [...items]
      .filter((i) => (filter === 'all' ? true : i.status === filter))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [items, filter])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <BookX className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">错题本</span>
        <span className="text-[11px] text-text-muted">{openCount} 待复习</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* 筛选 */}
      <div className="flex gap-1 mb-2">
        {([['open', '待复习'], ['mastered', '已掌握'], ['all', '全部']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
              filter === v ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <select value={subject} onChange={(e) => setSubject(e.target.value)}
            className="text-[11px] px-2 py-1 rounded-md bg-background border border-border/60 text-text-muted">
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="题目内容…" rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="正确答案与解析…" rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="错因分析（可选）"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            收录错题
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {filtered.length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">没有{filter === 'open' ? '待复习' : filter === 'mastered' ? '已掌握' : ''}的错题</div>
        )}
        {filtered.map((m) => (
          <div key={m.id} className={`group px-2.5 py-2 rounded-lg border transition-colors ${m.status === 'open' ? 'border-border/50' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] px-1.5 py-px rounded bg-accent/10 text-accent flex-shrink-0">{m.subject}</span>
                  <span className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 ${
                    m.status === 'open' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    {m.status === 'open' ? '待复习' : '已掌握'}
                  </span>
                </div>
                <div className="text-[12px] leading-snug">{m.question}</div>
                <details className="mt-1">
                  <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-primary">查看答案与解析</summary>
                  <div className="mt-1 text-[11px] text-text-muted leading-relaxed whitespace-pre-line">
                    <div className="text-emerald-500">答案：{m.answer}</div>
                    {m.reason && <div className="text-amber-500 mt-0.5">错因：{m.reason}</div>}
                  </div>
                </details>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                {m.status === 'open' ? (
                  <button
                    onClick={() => update(m.id, { status: 'mastered', reviewedAt: Date.now() })}
                    title="重做通过，标记已掌握"
                    className="text-emerald-500 hover:bg-emerald-500/10 rounded p-0.5 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => update(m.id, { status: 'open' })}
                    title="重新标记待复习"
                    className="text-text-muted hover:text-amber-500 rounded p-0.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => remove(m.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 rounded p-0.5 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-text-muted/70">
          <GraduationCap className="w-3 h-3" /> 定期重做错题，直到完全掌握
        </div>
      )}
    </div>
  )
}
