/**
 * 喝水打卡 — 生活模式核心工具
 *
 * 功能：每日饮水目标、进度环、一键打卡、近 7 日柱状
 */

import { useMemo } from 'react'
import { Droplets, Plus, Minus, Target, RotateCcw } from 'lucide-react'
import { useWaterStore, todayStr } from '../stores'

export default function LifeWater() {
  const { cups, target, add, setTarget, resetDay } = useWaterStore()
  const today = todayStr()
  const todayCups = cups[today] ?? 0
  const percent = Math.min(100, Math.round((todayCups / target) * 100))

  const week = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return { date: ds, count: cups[ds] ?? 0 }
    })
  }, [cups])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Droplets className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">喝水打卡</span>
        <span className="text-[11px] text-text-muted">目标 {target} 杯/天</span>
      </div>

      {/* 进度环 */}
      <div className="flex items-center gap-5 py-3">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(var(--border),0.5)" strokeWidth="10" />
            <circle
              cx="60" cy="60" r="52" fill="none" stroke="#38bdf8" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - percent / 100)}
              style={{ transition: 'stroke-dashoffset 0.4s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{todayCups}<span className="text-[11px] text-text-muted">/{target}</span></span>
            <span className="text-[10px] text-text-muted">{percent}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => add(-1)} className="w-7 h-7 rounded-full border border-border/60 text-text-muted hover:text-accent hover:border-accent/50 flex items-center justify-center transition-colors">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => add(1)} className="flex-1 py-2 rounded-lg bg-sky-500 text-white text-[13px] flex items-center justify-center gap-1 hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> 喝一杯
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              type="number" min={1} max={30} value={target}
              onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 8))}
              className="flex-1 text-[11px] px-2 py-1 rounded-md bg-surface border border-border/50 focus:outline-none"
            />
            <button onClick={() => resetDay(today)} className="text-[10px] text-text-muted hover:text-red-500 transition-colors flex items-center gap-0.5">
              <RotateCcw className="w-2.5 h-2.5" /> 重置
            </button>
          </div>
        </div>
      </div>

      {/* 近7日 */}
      <div className="mt-1 mb-3">
        <div className="text-[11px] text-text-muted mb-1.5">近 7 天</div>
        <div className="flex items-end gap-1.5 h-16">
          {week.map((w) => (
            <div key={w.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-text-muted tabular-nums">{w.count}</span>
              <div
                className={`w-full rounded-t ${w.count >= target ? 'bg-emerald-400' : w.count > 0 ? 'bg-sky-400/80' : 'bg-border/40'}`}
                style={{ height: `${Math.max(4, (w.count / Math.max(target, 1)) * 40)}px` }}
              />
              <span className="text-[9px] text-text-muted">{w.date.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-text-muted/70 px-1">
        💡 建议少量多次：每小时一杯，晚上减少饮水避免影响睡眠。
      </div>
    </div>
  )
}
