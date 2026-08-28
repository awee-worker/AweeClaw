/**
 * 阅读助手 — 学习模式增强工具
 *
 * 功能：阅读清单（想读/在读/读完）、进度管理、摘要记录
 */

import { useState } from 'react'
import { BookOpen, Plus, Trash2, CheckCircle2, BookmarkPlus } from 'lucide-react'
import { useReadingStore } from '../stores'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  wish: { label: '想读', cls: 'text-sky-500 bg-sky-500/10 border-sky-500/30' },
  reading: { label: '在读', cls: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
  done: { label: '读完', cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
}

export default function StudyReader() {
  const { items, add, update, remove } = useReadingStore()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState<'wish' | 'reading' | 'done'>('wish')

  const order = { wish: 0, reading: 1, done: 2 }
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status])

  const handleAdd = () => {
    if (!title.trim()) return
    add({ title: title.trim(), url: url.trim() || undefined, summary: summary.trim() || undefined, progress: 0, status })
    setTitle('')
    setUrl('')
    setSummary('')
    setShowForm(false)
  }

  const handleProgress = (id: string, delta: number) => {
    const item = items.find((i) => i.id === id)
    if (!item) return
    const p = Math.min(100, Math.max(0, item.progress + delta))
    update(id, { progress: p, status: p >= 100 ? 'done' : item.status === 'wish' ? 'reading' : item.status })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <BookOpen className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">阅读助手</span>
        <span className="text-[12px] text-text-muted">{items.filter((i) => i.status === 'done').length}/{items.length} 读完</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="书名 / 文章标题 *"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="链接（可选）"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="摘要 / 想读原因…" rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <div className="flex gap-1">
            {(['wish', 'reading', 'done'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`flex-1 py-1 rounded-md text-[12px] border transition-colors ${status === s ? STATUS_META[s].cls : 'border-border/50 text-text-muted'}`}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            加入清单
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
        {sorted.length === 0 && !showForm && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">建立你的阅读清单</div>
        )}
        {sorted.map((r) => (
          <div key={r.id} className="group px-2.5 py-2 rounded-lg border border-border/40">
            <div className="flex items-center gap-2">
              <span className={`text-[12px] px-1.5 py-px rounded border flex-shrink-0 ${STATUS_META[r.status].cls}`}>
                {STATUS_META[r.status].label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">{r.title}</div>
                {r.url && <div className="text-[12px] text-accent truncate">{r.url}</div>}
              </div>
              <button
                onClick={() => update(r.id, { status: r.status === 'done' ? 'reading' : 'done' })}
                title={r.status === 'done' ? '标记未读完' : '标记读完'}
                className={`transition-colors ${r.status === 'done' ? 'text-emerald-500' : 'text-text-muted hover:text-emerald-500'}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {r.summary && <div className="text-[12px] text-text-muted mt-1 line-clamp-2">{r.summary}</div>}
            {r.status === 'reading' && (
              <div className="flex items-center gap-2 mt-1.5">
                <button onClick={() => handleProgress(r.id, -10)} className="text-[12px] text-text-muted px-1.5 py-0.5 rounded border border-border/50 hover:text-text-primary">-10%</button>
                <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${r.progress}%` }} />
                </div>
                <span className="text-[12px] text-text-muted tabular-nums">{r.progress}%</span>
                <button onClick={() => handleProgress(r.id, 10)} className="text-[12px] text-text-muted px-1.5 py-0.5 rounded border border-border/50 hover:text-text-primary">+10%</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[12px] text-text-muted/70">
          <BookmarkPlus className="w-3 h-3" /> 把阅读进度推进到 100% 自动标记读完
        </div>
      )}
    </div>
  )
}
