/**
 * 心情日记 — 生活模式核心工具
 *
 * 功能：1-5 星情绪打卡 + 一句话日记 + 近 7 天趋势 + 情绪统计
 */

import { useMemo, useState } from 'react'
import { HeartHandshake, Send, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useMoodStore, todayStr } from '../stores'

const MOOD_META = [
  { emoji: '😞', label: '低落', color: '#94a3b8' },
  { emoji: '😕', label: '一般', color: '#60a5fa' },
  { emoji: '😐', label: '还行', color: '#facc15' },
  { emoji: '😊', label: '不错', color: '#fb923c' },
  { emoji: '😄', label: '很棒', color: '#f472b6' },
]

export default function LifeMoodDiary() {
  const { items, add, remove } = useMoodStore()
  const [mood, setMood] = useState(4)
  const [text, setText] = useState('')

  const today = todayStr()
  const todayEntry = items.find((i) => i.date === today)

  const handleSave = () => {
    add({ mood, text: text.trim() || undefined, date: today })
    setText('')
    setMood(4)
  }

  const week = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return { date: ds, entry: items.find((e) => e.date === ds) }
    })
  }, [items])

  const avgMood = useMemo(() => {
    if (items.length === 0) return 0
    return items.slice(0, 30).reduce((s, i) => s + i.mood, 0) / Math.min(30, items.length)
  }, [items])

  const avgThisWeek = week.filter((w) => w.entry).reduce((s, w) => s + w.entry!.mood, 0) / Math.max(1, week.filter((w) => w.entry).length)

  const trend = avgThisWeek - avgMood
  const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <HeartHandshake className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">心情日记</span>
        <span className="text-[12px] text-text-muted">累计 {items.length} 条</span>
      </div>

      {/* 今日打卡 */}
      <div className="p-3 rounded-xl bg-surface/70 border border-border/40 mb-3">
        <div className="text-[12px] text-text-muted mb-2">{todayEntry ? '今天的心情' : '今天感觉怎么样？'}</div>
        {todayEntry ? (
          <div className="flex items-center gap-2">
            <span className="text-2xl">{MOOD_META[todayEntry.mood - 1]?.emoji}</span>
            <div className="flex-1">
              <div className="text-[12px] font-medium">心情 {todayEntry.mood}/5</div>
              {todayEntry.text && <div className="text-[12px] text-text-muted">{todayEntry.text}</div>}
            </div>
            <button onClick={() => remove(todayEntry.id)} className="text-text-muted hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 mb-2">
              {MOOD_META.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setMood(i + 1)}
                  className={`flex-1 py-1.5 rounded-lg border text-center transition-all ${
                    mood === i + 1 ? 'border-accent/60 bg-accent/10 scale-105' : 'border-border/50 hover:border-border'
                  }`}
                >
                  <div className="text-[18px]">{m.emoji}</div>
                  <div className="text-[12px] text-text-muted">{m.label}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="一句话记录今天…"
                className="flex-1 text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none"
              />
              <button onClick={handleSave} className="px-3 py-1.5 rounded-md bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 transition-opacity">
                <Send className="w-3 h-3" /> 记录
              </button>
            </div>
          </>
        )}
      </div>

      {/* 趋势 */}
      <div className="flex items-center gap-3 px-1 mb-2">
        <span className="text-[12px] text-text-muted">近7天平均</span>
        <span className="text-[14px] font-semibold">{avgThisWeek.toFixed(1)}/5</span>
        {Math.abs(trend) > 0.05 && (
          <span className={`text-[12px] flex items-center gap-0.5 ${trend > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend > 0 ? '+' : ''}{trend.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1.5 h-14 mb-3 px-0.5">
        {week.map((w) => (
          <div key={w.date} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[16px]">{w.entry ? MOOD_META[w.entry.mood - 1]?.emoji : ''}</span>
            <div
              className={`w-full rounded-t ${w.entry ? 'bg-accent/70' : 'bg-border/30'}`}
              style={{ height: `${w.entry ? (w.entry.mood / 5) * 32 : 4}px` }}
            />
            <span className="text-[9px] text-text-muted">{w.date.slice(5).replace('-', '/')}</span>
          </div>
        ))}
      </div>

      {/* 历史 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        <div className="text-[12px] text-text-muted mb-1">最近记录</div>
        {sorted.length === 0 && <div className="text-center text-[12px] text-text-muted/60 py-6">还没有心情记录</div>}
        {sorted.map((e) => (
          <div key={e.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg border border-border/40">
            <span className="text-[16px]">{MOOD_META[e.mood - 1]?.emoji}</span>
            <div className="flex-1 min-w-0">
              {e.text && <div className="text-[12px] leading-snug">{e.text}</div>}
              <div className="text-[12px] text-text-muted mt-0.5">{e.date} · {MOOD_META[e.mood - 1]?.label}</div>
            </div>
            <button onClick={() => remove(e.id)} className="opacity-0 hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
