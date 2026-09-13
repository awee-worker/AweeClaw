/**
 * 学习仪表盘 — 学习模式增强工具
 *
 * 功能：聚合闪卡/学习番茄钟/错题数据 → 今日概览、近7天时长、掌握度
 */

import { useMemo } from 'react'
import { BarChart3, Layers, AlarmClock, BookX, Flame, Target } from 'lucide-react'
import { useFlashcardStore, usePomodoroStore, useMistakeStore, todayStr } from '../stores'

export default function StudyDashboard() {
  const cards = useFlashcardStore((s) => s.cards)
  const pomoRecords = usePomodoroStore((s) => s.records)
  const mistakes = useMistakeStore((s) => s.items)

  const studyRecords = useMemo(() => pomoRecords.filter((r) => r.kind === 'study'), [pomoRecords])

  // 近7天
  const week = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const mins = studyRecords.filter((r) => r.date === ds).reduce((s, r) => s + r.minutes, 0)
      return { date: ds, minutes: mins }
    })
  }, [studyRecords])

  const todayMinutes = week[6].minutes
  const weekMinutes = week.reduce((s, d) => s + d.minutes, 0)
  const maxDay = Math.max(...week.map((d) => d.minutes), 1)

  // 连续打卡天数
  const streak = useMemo(() => {
    let count = 0
    const days = new Set(studyRecords.map((r) => r.date))
    const d = new Date()
    while (days.has(todayStr(d))) {
      count++
      d.setDate(d.getDate() - 1)
    }
    return count
  }, [studyRecords])

  const dueCards = cards.filter((c) => c.nextReview <= Date.now()).length
  const masteredCards = cards.filter((c) => c.box >= 4).length
  const openMistakes = mistakes.filter((m) => m.status === 'open').length
  const mastery = cards.length > 0 ? Math.round((masteredCards / cards.length) * 100) : 0

  const totalFocusMin = studyRecords.reduce((s, r) => s + r.minutes, 0)

  const stats = [
    { label: '今日专注', value: `${todayMinutes}分`, icon: <AlarmClock className="w-3.5 h-3.5" />, color: 'text-emerald-500' },
    { label: '本周专注', value: `${weekMinutes}分`, icon: <BarChart3 className="w-3.5 h-3.5" />, color: 'text-sky-500' },
    { label: '连续打卡', value: `${streak}天`, icon: <Flame className="w-3.5 h-3.5" />, color: 'text-orange-500' },
    { label: '累计专注', value: `${Math.round(totalFocusMin / 60)}h`, icon: <Target className="w-3.5 h-3.5" />, color: 'text-accent' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <BarChart3 className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">学习仪表盘</span>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {stats.map((s) => (
          <div key={s.label} className="px-3 py-2.5 rounded-xl bg-surface/70 border border-border/40">
            <div className={`flex items-center gap-1 ${s.color}`}>{s.icon}<span className="text-[12px] text-text-muted ml-0.5">{s.label}</span></div>
            <div className="text-[18px] font-semibold mt-0.5 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 近7天 */}
      <div className="mb-3">
        <div className="text-[12px] text-text-muted mb-1.5">近 7 天学习时长</div>
        <div className="flex items-end gap-1.5 h-20">
          {week.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-text-muted tabular-nums">{d.minutes > 0 ? `${d.minutes}` : ''}</span>
              <div
                className={`w-full rounded-t ${d.minutes > 0 ? 'bg-emerald-400/80' : 'bg-border/30'}`}
                style={{ height: `${Math.max(4, (d.minutes / maxDay) * 52)}px` }}
              />
              <span className="text-[9px] text-text-muted">{d.date.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 学习资产 */}
      <div className="text-[12px] text-text-muted mb-1.5">学习资产</div>
      <div className="grid grid-cols-3 gap-2">
        <div className="px-3 py-2 rounded-xl bg-surface/70 border border-border/40">
          <div className="flex items-center gap-1 text-accent"><Layers className="w-3 h-3" /><span className="text-[12px] text-text-muted">闪卡</span></div>
          <div className="text-[15px] font-semibold mt-0.5">{cards.length}<span className="text-[12px] text-text-muted ml-1">张</span></div>
          <div className="text-[12px] text-amber-500">{dueCards} 待复习</div>
        </div>
        <div className="px-3 py-2 rounded-xl bg-surface/70 border border-border/40">
          <div className="flex items-center gap-1 text-emerald-500"><Layers className="w-3 h-3" /><span className="text-[12px] text-text-muted">掌握度</span></div>
          <div className="text-[15px] font-semibold mt-0.5 tabular-nums">{mastery}<span className="text-[12px] text-text-muted">%</span></div>
          <div className="text-[12px] text-text-muted">{masteredCards} 张已掌握</div>
        </div>
        <div className="px-3 py-2 rounded-xl bg-surface/70 border border-border/40">
          <div className="flex items-center gap-1 text-red-500"><BookX className="w-3 h-3" /><span className="text-[12px] text-text-muted">错题</span></div>
          <div className="text-[15px] font-semibold mt-0.5">{mistakes.length}<span className="text-[12px] text-text-muted">题</span></div>
          <div className="text-[12px] text-amber-500">{openMistakes} 待复习</div>
        </div>
      </div>

      <div className="mt-auto pt-3 text-[12px] text-text-muted/50">
        数据来自闪卡复习、学习番茄钟、错题本 · 持续学习，稳步提升 📈
      </div>
    </div>
  )
}
