/**
 * 工具执行耗时显示
 * 采用「计时器 Hook + 格式化器」分离模式
 */
import { useState, useEffect } from 'react'

/** 格式化耗时为展示文本 */
function formatElapsed(ms: number): string {
  if (ms <= 0) return ''
  const seconds = ms / 1000
  return seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()
}

interface ToolElapsedTimeProps {
  startTime?: number
  endTime?: number
  isRunning: boolean
}

export function ToolElapsedTime({ startTime, endTime, isRunning }: ToolElapsedTimeProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!isRunning || !startTime) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning, startTime])

  if (!startTime) return null

  /**
   * 已结束（有 endTime）就固定显示结束时的耗时。
   *
   * 之前一律按 isRunning 走「现在 - 开始时间」：只要流式预览标记没有及时清理，
   * 卡片会继续走表，显示的时长会比命令实际执行时间更长（长命令尤其明显，
   * sleep 100 会被显示成两百秒上下）。endTime 才是唯一可信的结束时刻。
   */
  const elapsed = endTime
    ? Math.max(0, endTime - startTime)
    : isRunning
      ? Math.max(0, now - startTime)
      : 0
  const display = formatElapsed(elapsed)
  if (!display) return null

  return <span className="text-[11px] text-text-muted/60 tabular-nums flex-shrink-0">{display}s</span>
}
