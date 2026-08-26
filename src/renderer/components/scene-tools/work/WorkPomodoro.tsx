/**
 * 番茄专注钟 — 工作模式核心工具
 *
 * 功能：专注/休息循环计时、今日专注统计、时长设置
 * 数据：专注记录自动沉淀，可供周报生成器调用
 */

import { useEffect, useMemo } from 'react'
import { Play, Pause, RotateCcw, Timer, Coffee, SkipForward, CheckCircle2, Settings2 } from 'lucide-react'
import { usePomodoroStore, todayStr } from '../stores'

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function WorkPomodoro() {
  const store = usePomodoroStore()
  const { settings, phase, running, remainingSec, round, records } = store

  // 计时驱动
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => usePomodoroStore.getState().tick(), 1000)
    return () => clearInterval(timer)
  }, [running])

  const todayRecords = useMemo(() => records.filter((r) => r.date === todayStr() && r.kind === 'work'), [records])
  const totalMinutes = todayRecords.reduce((sum, r) => sum + r.minutes, 0)

  const phaseMeta = {
    focus: { label: '专注中', cls: 'text-accent border-accent/40 bg-accent/10' },
    break: { label: '短休息', cls: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10' },
    longBreak: { label: '长休息', cls: 'text-sky-500 border-sky-500/40 bg-sky-500/10' },
    idle: { label: '待开始', cls: 'text-text-muted border-border bg-surface' },
  }[phase]

  const progress = phase === 'idle' ? 0 : 1 - remainingSec / (settings.focusMin * 60)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Timer className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">番茄专注钟</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${phaseMeta.cls}`}>{phaseMeta.label}</span>
      </div>

      {/* 计时主体 */}
      <div className="flex flex-col items-center py-4">
        <div className="relative w-40 h-40">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(var(--border),0.5)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke={phase === 'focus' ? 'rgb(var(--accent))' : '#10b981'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums">{fmt(remainingSec)}</span>
            <span className="text-[11px] text-text-muted mt-0.5">
              {phase === 'idle' ? '准备开始' : `第 ${Math.min(round + 1, settings.roundsBeforeLongBreak)} / ${settings.roundsBeforeLongBreak} 轮`}
            </span>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center gap-2 mt-4">
          {phase === 'idle' || phase === 'break' || phase === 'longBreak' ? (
            <button
              onClick={() => store.start('work')}
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              <Play className="w-3.5 h-3.5" /> 开始专注
            </button>
          ) : (
            <>
              <button
                onClick={() => (running ? store.pause() : store.resume())}
                className="px-4 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {running ? '暂停' : '继续'}
              </button>
              <button
                onClick={() => store.complete()}
                title="提前结束本轮并记录"
                className="px-3 py-1.5 rounded-lg border border-border/60 text-text-muted text-[12px] flex items-center gap-1.5 hover:text-emerald-500 hover:border-emerald-500/40 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> 完成
              </button>
            </>
          )}
          {(phase === 'break' || phase === 'longBreak') && (
            <button
              onClick={() => store.skipBreak()}
              className="px-3 py-1.5 rounded-lg border border-border/60 text-text-muted text-[12px] flex items-center gap-1.5 hover:text-text-primary transition-colors"
            >
              <SkipForward className="w-3.5 h-3.5" /> 跳过休息
            </button>
          )}
          <button
            onClick={() => store.reset()}
            title="重置"
            className="px-2 py-1.5 rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 今日统计 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/70 border border-border/40 mb-3">
        <Coffee className="w-4 h-4 text-accent" />
        <span className="text-[12px] text-text-muted">今日专注</span>
        <span className="text-[13px] font-semibold">{todayRecords.length} 个番茄</span>
        <span className="text-[11px] text-text-muted">≈ {totalMinutes} 分钟</span>
      </div>

      {/* 设置 */}
      <details className="mb-2 group">
        <summary className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer hover:text-text-primary transition-colors select-none">
          <Settings2 className="w-3 h-3" /> 时长设置
        </summary>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {([
            { key: 'focusMin', label: '专注(分)' },
            { key: 'breakMin', label: '短休(分)' },
            { key: 'longBreakMin', label: '长休(分)' },
          ] as const).map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-text-muted">{label}</span>
              <input
                type="number" min={1} max={120}
                value={settings[key]}
                onChange={(e) => store.setSettings({ [key]: Math.max(1, Number(e.target.value) || 25) })}
                className="text-[12px] px-2 py-1 rounded-md bg-surface border border-border/60 focus:outline-none focus:border-accent/60"
              />
            </label>
          ))}
        </div>
      </details>

      {/* 历史记录 */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-1">
        <div className="text-[11px] text-text-muted mb-1">最近记录</div>
        {records.length === 0 && <div className="text-center text-[12px] text-text-muted/60 py-4">还没有专注记录</div>}
        {records.slice(0, 20).map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] text-text-muted">
            <span className="w-2 h-2 rounded-full bg-accent/70 flex-shrink-0" />
            <span className="flex-1">{r.date}</span>
            <span>{r.minutes} 分钟</span>
            {r.subject && <span className="text-text-muted/70">{r.subject}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
