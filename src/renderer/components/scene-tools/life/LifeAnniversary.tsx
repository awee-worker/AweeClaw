/**
 * 纪念日提醒 — 生活模式增强工具
 *
 * 功能：生日/纪念日登记、倒计时展示、当年天数计算
 */

import { useMemo, useState } from 'react'
import { Cake, Plus, Trash2, Gift, Heart, CalendarHeart, CalendarDays } from 'lucide-react'
import { useAnniversaryStore } from '../stores'

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  birthday: { label: '生日', icon: <Cake className="w-3 h-3" />, cls: 'text-pink-500 bg-pink-500/10 border-pink-500/30' },
  anniversary: { label: '纪念日', icon: <Heart className="w-3 h-3" />, cls: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
  custom: { label: '其他', icon: <Gift className="w-3 h-3" />, cls: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
}

/** 计算下次到来的天数 */
function daysUntil(dateStr: string, repeatYearly: boolean): { days: number; dateLabel: string } {
  const now = new Date()
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  if (repeatYearly) {
    const thisYear = new Date(now.getFullYear(), m - 1, d)
    let next = thisYear
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (thisYear < todayStart) next = new Date(now.getFullYear() + 1, m - 1, d)
    const diff = Math.round((next.getTime() - todayStart.getTime()) / 86400000)
    return { days: diff, dateLabel: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}` }
  }
  const diff = Math.round((target.getTime() - now.getTime()) / 86400000)
  return { days: diff, dateLabel: dateStr }
}

export default function LifeAnniversary() {
  const { items, add, remove } = useAnniversaryStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState<'birthday' | 'anniversary' | 'custom'>('birthday')
  const [repeatYearly, setRepeatYearly] = useState(true)

  const handleAdd = () => {
    if (!name.trim() || !date) return
    add({ name: name.trim(), date, type, repeatYearly })
    setName('')
    setDate('')
    setShowForm(false)
  }

  const sorted = useMemo(() => {
    return [...items]
      .map((i) => ({ ...i, countdown: daysUntil(i.date, i.repeatYearly) }))
      .sort((a, b) => a.countdown.days - b.countdown.days)
  }, [items])

  const nearest = sorted[0]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <CalendarHeart className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">纪念日提醒</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto w-5 h-5 rounded-md bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {nearest && (
        <div className="p-3 rounded-xl bg-gradient-to-br from-pink-500/10 to-rose-500/10 border border-pink-500/20 mb-3">
          <div className="text-[12px] text-text-muted mb-1">最近的重要日子</div>
          <div className="text-[15px] font-semibold">{nearest.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[22px] font-semibold text-rose-500 tabular-nums">
              {nearest.countdown.days === 0 ? '就是今天 🎉' : `还有 ${nearest.countdown.days} 天`}
            </span>
            <span className="text-[12px] text-text-muted">{nearest.countdown.dateLabel}</span>
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg bg-surface border border-border/50">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称，如：妈妈的生日"
            className="w-full text-[12px] px-2 py-1.5 rounded-md bg-background border border-border/60 focus:outline-none" />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="flex-1 text-[12px] px-2 py-1 rounded-md bg-background border border-border/60 text-text-muted" />
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}
              className="text-[12px] px-1.5 py-1 rounded-md bg-background border border-border/60 text-text-muted">
              <option value="birthday">生日</option>
              <option value="anniversary">纪念日</option>
              <option value="custom">其他</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <input type="checkbox" checked={repeatYearly} onChange={(e) => setRepeatYearly(e.target.checked)} />
            每年重复
          </label>
          <button onClick={handleAdd} className="w-full py-1.5 rounded-md bg-accent text-white text-[12px] hover:opacity-90 transition-opacity">
            保存
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {items.length === 0 && !showForm && (
          <div className="text-center text-[12px] text-text-muted/60 py-8">记录生日与纪念日，不错过重要日子</div>
        )}
        {sorted.map((i) => (
          <div key={i.id} className="group flex items-center gap-2 px-2 py-2 rounded-lg border border-border/40">
            <span className={`px-1.5 py-0.5 rounded text-[12px] border flex items-center gap-0.5 flex-shrink-0 ${TYPE_META[i.type].cls}`}>
              {TYPE_META[i.type].icon} {TYPE_META[i.type].label}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium truncate">{i.name}</div>
              <div className="text-[12px] text-text-muted flex items-center gap-1">
                <CalendarDays className="w-2.5 h-2.5" /> {i.date}{i.repeatYearly ? ' · 每年' : ''}
              </div>
            </div>
            <span className={`text-[12px] font-semibold tabular-nums flex-shrink-0 ${i.countdown.days <= 7 ? 'text-rose-500' : 'text-text-muted'}`}>
              {i.countdown.days === 0 ? '今天' : `${i.countdown.days}天`}
            </span>
            <button onClick={() => remove(i.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
