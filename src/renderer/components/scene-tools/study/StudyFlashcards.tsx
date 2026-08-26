/**
 * 闪卡复习 — 学习模式核心工具
 *
 * 功能：Leitner 间隔重复（贴合遗忘曲线）、牌组管理、正反翻卡、对/错反馈
 * 复习规则：答对 → 升级盒子并推迟复习；答错 → 回到盒子1，30分钟后重试
 */

import { useMemo, useState } from 'react'
import { Layers, Plus, Trash2, RefreshCw, Check, X, Eye, EyeOff, ChevronLeft, ChevronRight, BookPlus } from 'lucide-react'
import { useFlashcardStore } from '../stores'

export default function StudyFlashcards() {
  const store = useFlashcardStore()
  const { cards, decks } = store

  const [deck, setDeck] = useState('全部')
  const [showForm, setShowForm] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [newDeck, setNewDeck] = useState('')
  const [reviewIdx, setReviewIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [view, setView] = useState<'review' | 'list'>('review')

  // 待复习卡片（到期 或 新卡），按到期时间排序
  const dueCards = useMemo(() => {
    const now = Date.now()
    return cards
      .filter((c) => (deck === '全部' ? true : c.deck === deck) && c.nextReview <= now)
      .sort((a, b) => a.nextReview - b.nextReview)
  }, [cards, deck])

  const current = dueCards[Math.min(reviewIdx, dueCards.length - 1)]

  const handleAdd = () => {
    if (!front.trim() || !back.trim()) return
    store.addCard(front.trim(), back.trim(), deck === '全部' ? '默认' : deck)
    setFront('')
    setBack('')
  }

  const handleAddDeck = () => {
    if (!newDeck.trim()) return
    store.addDeck(newDeck.trim())
    setDeck(newDeck.trim())
    setNewDeck('')
  }

  const review = (correct: boolean) => {
    if (!current) return
    store.review(current.id, correct)
    setFlipped(false)
    setReviewIdx((i) => (i + 1 >= dueCards.length ? 0 : i + 1))
  }

  const stats = useMemo(() => {
    const due = cards.filter((c) => c.nextReview <= Date.now()).length
    const mastered = cards.filter((c) => c.box >= 4).length
    return { total: cards.length, due, mastered }
  }, [cards])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-2">
        <Layers className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">闪卡复习</span>
        <span className="text-[11px] text-text-muted">{stats.total} 张 · {stats.mastered} 已掌握</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* 牌组选择 */}
      <div className="flex items-center gap-1.5 mb-2">
        <select
          value={deck} onChange={(e) => { setDeck(e.target.value); setReviewIdx(0); setFlipped(false) }}
          className="flex-1 text-[11px] px-2 py-1.5 rounded-md bg-surface border border-border/50 text-text-muted focus:outline-none"
        >
          <option value="全部">全部牌组</option>
          {decks.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex gap-1">
          <button
            onClick={() => setView('review')}
            className={`px-2 py-1 rounded-md text-[11px] transition-colors ${view === 'review' ? 'bg-accent/10 text-accent' : 'text-text-muted'}`}
          >
            复习 <span className="text-accent font-semibold">{stats.due}</span>
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-2 py-1 rounded-md text-[11px] transition-colors ${view === 'list' ? 'bg-accent/10 text-accent' : 'text-text-muted'}`}
          >
            列表
          </button>
        </div>
      </div>

      {/* 新增表单 */}
      {showForm && (
        <div className="space-y-2 mb-2 p-2.5 rounded-lg bg-surface border border-border/50">
          <div className="flex gap-2">
            <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="正面（问题/单词）"
              className="flex-1 text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
            <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="背面（答案/释义）"
              className="flex-1 text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
            <button onClick={handleAdd} className="px-2.5 py-1.5 rounded-md bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity">
              <BookPlus className="w-3 h-3" />
            </button>
          </div>
          <div className="flex gap-2">
            <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="新牌组名（可选）"
              className="flex-1 text-[11px] px-2 py-1 rounded-md bg-background border border-border/60 focus:outline-none" />
            <button onClick={handleAddDeck} className="px-2 py-1 rounded-md border border-border/60 text-[11px] text-text-muted hover:text-text-primary transition-colors">
              新建牌组
            </button>
          </div>
        </div>
      )}

      {/* 复习视图 */}
      {view === 'review' && (
        <div className="flex-1 flex flex-col min-h-0">
          {current ? (
            <>
              <div className="text-center text-[10px] text-text-muted mb-1">
                待复习 {dueCards.length} 张 · 第 {Math.min(reviewIdx + 1, dueCards.length)} 张 · 盒子{current.box}
              </div>
              <div
                className="flex-1 flex items-center justify-center cursor-pointer select-none px-3 py-4 rounded-xl bg-surface/70 border border-border/50 hover:border-accent/40 transition-colors"
                onClick={() => setFlipped((v) => !v)}
              >
                <div className="text-center">
                  <div className="text-[15px] font-medium leading-relaxed">{flipped ? current.back : current.front}</div>
                  <div className="mt-3 text-[10px] text-text-muted flex items-center justify-center gap-1">
                    {flipped ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    点击卡片翻转
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => review(false)}
                  className="flex-1 py-2 rounded-lg bg-red-500/10 text-red-500 text-[13px] flex items-center justify-center gap-1 hover:bg-red-500/20 transition-colors"
                >
                  <X className="w-4 h-4" /> 忘记了
                </button>
                <button
                  onClick={() => review(true)}
                  className="flex-1 py-2 rounded-lg bg-emerald-500/10 text-emerald-500 text-[13px] flex items-center justify-center gap-1 hover:bg-emerald-500/20 transition-colors"
                >
                  <Check className="w-4 h-4" /> 记住了
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted/60">
              <RefreshCw className="w-8 h-8" />
              <div className="text-[12px]">没有待复习的卡片 🎉</div>
              <div className="text-[11px] text-center px-4">根据遗忘曲线，已掌握的卡片会在合适的时间再次出现</div>
            </div>
          )}
        </div>
      )}

      {/* 列表视图 */}
      {view === 'list' && (
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
          {cards.filter((c) => deck === '全部' || c.deck === deck).length === 0 && (
            <div className="text-center text-[12px] text-text-muted/60 py-8">还没有卡片</div>
          )}
          {cards
            .filter((c) => deck === '全部' || c.deck === deck)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((c) => (
              <div key={c.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40">
                <span className="w-4 h-4 rounded text-[10px] bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                  {c.box}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate">{c.front}</div>
                  <div className="text-[10px] text-text-muted truncate">{c.back} · {c.deck}</div>
                </div>
                <div className="text-[10px] text-text-muted flex-shrink-0">
                  {c.wrongCount > 0 && <span className="text-red-500 mr-1">错{c.wrongCount}</span>}
                  {c.rightCount > 0 && <span className="text-emerald-500">对{c.rightCount}</span>}
                </div>
                <button onClick={() => store.removeCard(c.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
