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

  const elapsed = isRunning ? now - startTime : endTime ? endTime - startTime : 0
  const display = formatElapsed(elapsed)
  if (!display) return null

  return <span className="text-[11px] text-text-muted/60 tabular-nums flex-shrink-0">{display}s</span>
}
