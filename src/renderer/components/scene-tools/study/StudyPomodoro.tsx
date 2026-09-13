/**
 * 学习番茄钟 — 学习模式核心工具
 *
 * 功能：分科目专注计时、今日学习统计、记录进入学习时长数据
 * 数据：records(kind=study) 与学习仪表盘联动
 */

import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Play, Pause, RotateCcw, CheckCircle2, BookOpen, Coffee } from 'lucide-react'
import { usePomodoroStore, todayStr } from '../stores'

const SUBJECTS = ['数学', '英语', '编程', '阅读', '专业课', '其他']

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function StudyPomodoro() {
  const store = usePomodoroStore()
  const { phase, running, remainingSec, records, settings } = store
  const [subject, setSubject] = useState(SUBJECTS[0])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => usePomodoroStore.getState().tick(), 1000)
    return () => clearInterval(timer)
  }, [running])

  const todayRecords = useMemo(() => records.filter((r) => r.date === todayStr() && r.kind === 'study'), [records])
  const totalMin = todayRecords.reduce((s, r) => s + r.minutes, 0)
  const subjectStats = useMemo(() => {
    const map = new Map<string, number>()
    todayRecords.forEach((r) => map.set(r.subject ?? '其他', (map.get(r.subject ?? '其他') ?? 0) + r.minutes))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [todayRecords])

  const progress = phase === 'idle' ? 0 : 1 - remainingSec / (settings.focusMin * 60)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <AlarmClock className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">学习番茄钟</span>
        <span className={`text-[12px] px-1.5 py-0.5 rounded-full border ${
          phase === 'focus' ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10' : phase === 'idle' ? 'text-text-muted border-border bg-surface' : 'text-sky-500 border-sky-500/40 bg-sky-500/10'
        }`}>
          {phase === 'focus' ? '专注' : phase === 'idle' ? '待开始' : '休息'}
        </span>
      </div>

      {/* 科目选择 */}
      <div className="flex gap-1 flex-wrap mb-3">
        {SUBJECTS.map((s) => (
          <button
            key={s}
            onClick={() => setSubject(s)}
            className={`px-2 py-0.5 rounded-md text-[12px] border transition-colors ${
              subject === s ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40' : 'border-border/50 text-text-muted hover:border-border'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* 计时 */}
      <div className="flex flex-col items-center py-3">
        <div className="relative w-36 h-36">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(var(--border),0.5)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="52" fill="none" stroke="#10b981" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{fmt(remainingSec)}</span>
            <span className="text-[12px] text-text-muted mt-0.5">{subject}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          {phase === 'idle' || phase === 'break' ? (
            <button
              onClick={() => store.start('study', subject)}
              className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] flex items-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              <Play className="w-3.5 h-3.5" /> 开始学习
            </button>
          ) : (
            <>
              <button
                onClick={() => (running ? store.pause() : store.resume())}
                className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {running ? '暂停' : '继续'}
              </button>
              <button
                onClick={() => store.complete()}
                className="px-3 py-1.5 rounded-lg border border-border/60 text-text-muted text-[12px] flex items-center gap-1.5 hover:text-emerald-500 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> 完成
              </button>
            </>
          )}
          {phase === 'break' && (
            <button onClick={() => store.skipBreak()} className="px-3 py-1.5 rounded-lg border border-border/60 text-text-muted text-[12px] hover:text-text-primary transition-colors flex items-center gap-1.5">
              <Coffee className="w-3.5 h-3.5" /> 跳过休息
            </button>
          )}
          <button onClick={() => store.reset()} className="px-2 py-1.5 text-text-muted hover:text-text-primary transition-colors">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 今日统计 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/70 border border-border/40 mb-3">
        <BookOpen className="w-4 h-4 text-emerald-500" />
        <span className="text-[12px] text-text-muted">今日学习</span>
        <span className="text-[13px] font-semibold">{todayRecords.length} 个番茄</span>
        <span className="text-[12px] text-text-muted">≈ {totalMin} 分钟</span>
      </div>

      {/* 科目分布 */}
      {subjectStats.length > 0 && (
        <div className="space-y-1 mb-2">
          {subjectStats.map(([s, min]) => {
            const max = subjectStats[0][1]
            return (
              <div key={s} className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted w-10 flex-shrink-0">{s}</span>
                <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${(min / max) * 100}%` }} />
                </div>
                <span className="text-[12px] text-text-muted w-12 text-right">{min} 分</span>
              </div>
            )
          })}
        </div>
      )}

      {/* 历史 */}
      <div className="flex-1 overflow-y-auto no-scrollbar mt-1">
        <div className="text-[12px] text-text-muted mb-1">最近记录</div>
        {records.filter((r) => r.kind === 'study').length === 0 && (
          <div className="text-center text-[12px] text-text-muted/60 py-4">开始第一个学习番茄吧</div>
        )}
        {records.filter((r) => r.kind === 'study').slice(0, 15).map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-2 py-1 text-[12px] text-text-muted">
            <span className="w-2 h-2 rounded-full bg-emerald-500/70 flex-shrink-0" />
            <span className="flex-1">{r.date}</span>
            <span>{r.subject ?? '其他'}</span>
            <span>{r.minutes} 分钟</span>
          </div>
        ))}
      </div>
    </div>
  )
}
