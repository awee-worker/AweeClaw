/**
 * 快捷话术库 — 工作模式增强工具
 *
 * 功能：分类管理常用邮件/话术模板，一键复制
 */

import { useMemo, useState } from 'react'
import { MessageSquareQuote, Plus, Copy, Check, Trash2 } from 'lucide-react'
import { useSnippetStore } from '../stores'

const DEFAULT_CATEGORIES = ['邮件', '沟通', '汇报', '其他']

export default function WorkSnippets() {
  const { items, add, remove } = useSnippetStore()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('邮件')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState<string>('全部')

  const categories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES)
    items.forEach((i) => set.add(i.category))
    return Array.from(set)
  }, [items])

  const filtered = activeCat === '全部' ? items : items.filter((i) => i.category === activeCat)

  const handleAdd = () => {
    if (!title.trim() || !content.trim()) return
    add({ title: title.trim(), content: content.trim(), category })
    setTitle('')
    setContent('')
    setShowForm(false)
  }

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <MessageSquareQuote className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">快捷话术库</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* 分类标签 */}
      <div className="flex gap-1 flex-wrap mb-2">
        {['全部', ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setActiveCat(c)}
            className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
              activeCat === c ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <div className="flex gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题，如：进度同步邮件"
              className="flex-1 text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded-md bg-background border border-border/60 text-text-muted focus:outline-none">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="话术内容，可用 {变量} 占位…" rows={3}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            保存话术
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">暂无话术</div>
        )}
        {filtered.map((s) => (
          <div key={s.id} className="group px-2.5 py-2 rounded-lg border border-border/40 hover:border-border/70 transition-colors">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="flex-1 text-[12px] font-medium truncate">{s.title}</span>
              <button onClick={() => copy(s.id, s.content)} className="text-text-muted hover:text-accent transition-colors">
                {copiedId === s.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </button>
              <button onClick={() => remove(s.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="text-[11px] text-text-muted leading-relaxed line-clamp-3 whitespace-pre-line">{s.content}</div>
            <div className="text-[10px] text-accent/70 mt-1">{s.category}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
