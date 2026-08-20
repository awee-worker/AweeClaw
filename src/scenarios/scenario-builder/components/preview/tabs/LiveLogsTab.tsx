/**
 * 实时日志 Tab（LiveLogsTab）
 *
 * 通过 PreviewService.getLiveLogs() 拉取场景运行时的实时日志。
 *
 * 数据来源：
 *   - PreviewService.getLiveLogs(limit, level?)
 *   - 内部 logger ring buffer 按 scenarioId 过滤
 *
 * 交互能力：
 *   - 自动刷新（默认开启，每 3 秒拉取一次）
 *   - 手动刷新
 *   - 按级别筛选（all/info/warn/error/debug）
 *   - 按关键字搜索（消息内容包含匹配）
 *
 * 设计要点：
 *   - 字体 ≥ 12px
 *   - 不同级别用颜色区分：info 默认、warn 黄、error 红、debug 灰
 *   - 时间戳使用等宽字体，最新条目在底部
 *   - 自动滚动到底部，用户向上滚动查看历史时暂停跟随
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../../services'
import type { LiveLog, LogLevel } from '../../../services'
import {
  RefreshCw,
  AlertTriangle,
  Info,
  Bug,
  Search,
  Zap,
  ZapOff,
} from 'lucide-react'

interface LiveLogsTabProps {
  /** 当前预览的 scenarioId（null 表示未运行） */
  scenarioId: string | null
  /** 预览是否运行中 */
  running: boolean
}

const LEVEL_OPTIONS: Array<{ value: 'all' | LogLevel; key: string }> = [
  { value: 'all', key: 'all' },
  { value: 'info', key: 'info' },
  { value: 'warn', key: 'warn' },
  { value: 'error', key: 'error' },
  { value: 'debug', key: 'debug' },
]

const levelColor: Record<LogLevel, string> = {
  info: 'text-foreground/80',
  warn: 'text-yellow-600',
  error: 'text-destructive',
  debug: 'text-muted-foreground/70',
}

const levelIcon: Record<LogLevel, React.ReactNode> = {
  info: <Info className="h-3 w-3 shrink-0" />,
  warn: <AlertTriangle className="h-3 w-3 shrink-0" />,
  error: <AlertTriangle className="h-3 w-3 shrink-0" />,
  debug: <Bug className="h-3 w-3 shrink-0" />,
}

const LiveLogsTab: React.FC<LiveLogsTabProps> = ({ scenarioId, running }) => {
  const { t } = useI18n()
  const [logs, setLogs] = useState<LiveLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [keyword, setKeyword] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  /** 用户是否在手动滚动查看历史 */
  const userScrollingRef = useRef(false)

  // 拉取日志
  const fetchLogs = useCallback(async () => {
    if (!scenarioId || !running) {
      setLogs([])
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await previewService.getLiveLogs(500, level === 'all' ? undefined : level)
      if (!result.success) {
        setError(result.error || t('builder.preview.logs.loadFailed'))
        setLogs([])
        return
      }
      setLogs(result.logs)
    } catch (err) {
      setError((err as Error).message || t('builder.preview.logs.loadFailed'))
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [scenarioId, running, level, t])

  // 初始加载 & 自动刷新
  useEffect(() => {
    void fetchLogs()
    if (!autoRefresh || !running) return
    const timer = setInterval(() => {
      void fetchLogs()
    }, 3000)
    return () => clearInterval(timer)
  }, [fetchLogs, autoRefresh, running])

  // 切换级别/项目时重新拉取
  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  // 自动滚动到底部（除非用户手动滚动）
  useEffect(() => {
    if (userScrollingRef.current) return
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    userScrollingRef.current = !atBottom
  }, [])

  // 关键字过滤（在已拉取日志基础上前端筛选）
  const filteredLogs = useMemo(() => {
    if (!keyword.trim()) return logs
    const lower = keyword.trim().toLowerCase()
    return logs.filter((l) => l.message.toLowerCase().includes(lower))
  }, [logs, keyword])

  const handleRefresh = useCallback(() => {
    void fetchLogs()
  }, [fetchLogs])

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {/* 级别筛选 */}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as 'all' | LogLevel)}
            className="rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            title={t('builder.preview.logs.level')}
          >
            {LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(`builder.preview.logs.level.${opt.key}`)}
              </option>
            ))}
          </select>

          {/* 关键字搜索 */}
          <div className="relative flex-1">
            <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('builder.preview.logs.search')}
              className="w-full rounded border border-border bg-background py-0.5 pl-6 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* 自动刷新开关 */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] transition-colors ${
              autoRefresh
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            title={t('builder.preview.logs.autoRefresh')}
          >
            {autoRefresh ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
            {t('builder.preview.logs.autoRefresh')}
          </button>

          {/* 手动刷新 */}
          <button
            onClick={handleRefresh}
            disabled={loading || !running}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            title={t('builder.preview.logs.refresh')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 统计 */}
        <div className="mt-1 flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            {t('builder.preview.logs.count').replace('{count}', String(filteredLogs.length))}
          </span>
          {error && <span className="truncate text-destructive">{error}</span>}
        </div>
      </div>

      {/* 日志列表 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2"
      >
        {!running || !scenarioId ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.logs.notRunning')}
          </p>
        ) : filteredLogs.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.logs.empty')}
          </p>
        ) : (
          <ul className="space-y-0.5 font-mono text-[12px]">
            {filteredLogs.map((log, idx) => (
              <li
                key={`${idx}-${log.timestamp}`}
                className={`flex items-start gap-1.5 px-1 py-0.5 ${levelColor[log.level]}`}
              >
                <span className="shrink-0 text-muted-foreground/60">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span className="shrink-0">{levelIcon[log.level]}</span>
                <span className="shrink-0 text-muted-foreground/80">[{log.source}]</span>
                <span className="break-all">{log.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default LiveLogsTab
