/**
 * 笔记库 — 学习模式增强工具
 *
 * 功能：Markdown 笔记、标签、搜索、列表/详情
 */

import { useMemo, useState } from 'react'
import { NotebookPen, Plus, Trash2, Search, Tag } from 'lucide-react'
import { useNoteStore, uid } from '../stores'

export default function StudyNotes() {
  const { items, add, update, remove } = useNoteStore()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editTags, setEditTags] = useState('')

  const selected = items.find((i) => i.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...items]
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [items, search])

  const handleAdd = () => {
    if (!title.trim()) return
    add({
      title: title.trim(),
      content: content.trim(),
      tags: tagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      updatedAt: Date.now(),
    })
    setTitle('')
    setContent('')
    setTagsInput('')
    setShowForm(false)
  }

  const startEdit = () => {
    if (!selected) return
    setEditTitle(selected.title)
    setEditContent(selected.content)
    setEditTags(selected.tags.join(', '))
    setEditing(true)
  }

  const saveEdit = () => {
    if (!selected || !editTitle.trim()) return
    update(selected.id, {
      title: editTitle.trim(),
      content: editContent,
      tags: editTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      updatedAt: Date.now(),
    })
    setEditing(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <NotebookPen className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">笔记库</span>
        <span className="text-[12px] text-text-muted">{items.length} 篇</span>
        <button
          onClick={() => { setShowForm((v) => !v); setSelectedId(null) }}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative mb-2">
        <Search className="w-3 h-3 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题 / 内容 / 标签…"
          className="w-full text-[12px] pl-8 pr-2 py-1.5 rounded-lg bg-surface border border-border/50 focus:outline-none focus:border-accent/60"
        />
      </div>

      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="笔记标题 *"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容（支持 Markdown）…" rows={4}
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="标签，逗号分隔：算法, 笔记"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            保存笔记
          </button>
        </div>
      )}

      {/* 详情 */}
      {selected && !showForm && (
        <div className="mb-2 p-2.5 rounded-lg bg-surface/70 border border-accent/30 space-y-2">
          {editing ? (
            <>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-[13px] font-medium px-2 py-1 rounded-md bg-background border border-border/60 focus:outline-none" />
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={6}
                className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none resize-none" />
              <input value={editTags} onChange={(e) => setEditTags(e.target.value)}
                className="w-full text-[12px] px-2 py-1 rounded-md bg-background border border-border/60 focus:outline-none" />
              <div className="flex gap-2">
                <button onClick={saveEdit} className="flex-1 py-1 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">保存</button>
                <button onClick={() => setEditing(false)} className="px-3 py-1 rounded-md border border-border/60 text-[12px] text-text-muted">取消</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13px] font-medium break-words">{selected.title}</span>
                <button onClick={startEdit} className="text-[12px] text-accent hover:underline">编辑</button>
                <button onClick={() => { remove(selected.id); setSelectedId(null) }} className="text-text-muted hover:text-red-500 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[12px] text-text-muted whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto no-scrollbar">{selected.content}</div>
              <div className="flex gap-1 flex-wrap">
                {selected.tags.map((t) => (
                  <span key={t} className="text-[12px] px-1.5 py-px rounded bg-accent/10 text-accent flex items-center gap-0.5">
                    <Tag className="w-2 h-2" /> {t}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {filtered.length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">还没有笔记</div>
        )}
        {filtered.map((n) => (
          <button
            key={n.id}
            onClick={() => { setSelectedId(n.id); setShowForm(false); setEditing(false) }}
            className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
              selectedId === n.id ? 'border-accent/40 bg-accent/5' : 'border-border/40 hover:bg-surface/60'
            }`}
          >
            <div className="text-[12px] font-medium truncate">{n.title}</div>
            <div className="text-[12px] text-text-muted mt-0.5 truncate">{n.content}</div>
            <div className="flex items-center gap-1 mt-1">
              {n.tags.slice(0, 3).map((t) => (
                <span key={t} className="text-[9px] px-1 py-px rounded bg-accent/10 text-accent">{t}</span>
              ))}
              <span className="ml-auto text-[9px] text-text-muted">{new Date(n.updatedAt).toLocaleDateString()}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
