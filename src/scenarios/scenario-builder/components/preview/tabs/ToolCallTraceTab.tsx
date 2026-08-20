/**
 * 工具调用轨迹 Tab（ToolCallTraceTab）
 *
 * 通过 PreviewService.getToolCallTrace() 拉取场景运行时的工具调用记录。
 *
 * 数据来源：
 *   - PreviewService.getToolCallTrace(limit, toolName?)
 *   - 当前由渲染进程侧的 ScenarioRuntime 收集，主进程仅作占位接口
 *   - 后续可扩展为：渲染进程通过 IPC 上报 → 主进程 buffer → 查询接口
 *
 * 交互能力：
 *   - 手动刷新
 *   - 按工具名筛选
 *   - 展开查看入参 / 结果 / 错误信息
 *
 * 设计要点：
 *   - 字体 ≥ 12px
 *   - 状态用颜色区分：成功绿、失败红、执行中黄
 *   - 入参/结果使用等宽字体，可滚动
 *   - 耗时使用毫秒格式
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../../services'
import type { ToolCallTrace } from '../../../services'
import {
  RefreshCw,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
} from 'lucide-react'

interface ToolCallTraceTabProps {
  /** 当前预览的 scenarioId */
  scenarioId: string | null
  /** 预览是否运行中 */
  running: boolean
}

/** 根据 ToolCallTrace 字段派生展示状态 */
type DisplayStatus = 'success' | 'failed' | 'running'

function deriveStatus(trace: ToolCallTrace): DisplayStatus {
  if (trace.success === true) return 'success'
  if (trace.success === false) return 'failed'
  return 'running'
}

const statusColor: Record<DisplayStatus, string> = {
  success: 'text-emerald-600',
  failed: 'text-destructive',
  running: 'text-yellow-600',
}

const statusIcon: Record<DisplayStatus, React.ReactNode> = {
  success: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  running: <Loader2 className="h-3 w-3 animate-spin" />,
}

const ToolCallTraceTab: React.FC<ToolCallTraceTabProps> = ({ scenarioId, running }) => {
  const { t } = useI18n()
  const [traces, setTraces] = useState<ToolCallTrace[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [filter, setFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchTraces = useCallback(async () => {
    if (!scenarioId || !running) {
      setTraces([])
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await previewService.getToolCallTrace(200)
      if (!result.success) {
        setError(result.error || t('builder.preview.tools.loadFailed'))
        setTraces([])
        return
      }
      setTraces(result.traces)
    } catch (err) {
      setError((err as Error).message || t('builder.preview.tools.loadFailed'))
      setTraces([])
    } finally {
      setLoading(false)
    }
  }, [scenarioId, running, t])

  useEffect(() => {
    void fetchTraces()
  }, [fetchTraces])

  const handleRefresh = useCallback(() => {
    void fetchTraces()
  }, [fetchTraces])

  const handleToggleExpand = useCallback((callId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(callId)) {
        next.delete(callId)
      } else {
        next.add(callId)
      }
      return next
    })
  }, [])

  const filteredTraces = useMemo(() => {
    if (!filter.trim()) return traces
    const lower = filter.trim().toLowerCase()
    return traces.filter((tr) => tr.toolName.toLowerCase().includes(lower))
  }, [traces, filter])

  const formatDuration = (ms: number | null | undefined): string => {
    if (ms === null || ms === undefined) return '-'
    if (ms < 1) return '<1ms'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('builder.preview.tools.filter')}
            className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={handleRefresh}
            disabled={loading || !running}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            title={t('builder.preview.tools.refresh')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('builder.preview.tools.refresh')}
          </button>
        </div>
        {error && (
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-destructive">
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {!running || !scenarioId ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.tools.notRunning')}
          </p>
        ) : filteredTraces.length === 0 ? (
          <div className="space-y-2">
            <p className="px-1 py-2 text-[12px] text-muted-foreground/60">
              {t('builder.preview.tools.empty')}
            </p>
            <div className="flex items-start gap-1.5 rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{t('builder.preview.tools.tip')}</span>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredTraces.map((trace) => {
              const isExpanded = expanded.has(trace.callId)
              const status = deriveStatus(trace)
              return (
                <li
                  key={trace.callId}
                  className="rounded border border-border/60 bg-background"
                >
                  {/* 折叠头 */}
                  <button
                    onClick={() => handleToggleExpand(trace.callId)}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] hover:bg-muted/30"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <Wrench className={`h-3 w-3 shrink-0 ${statusColor[status]}`} />
                    <span className="font-mono text-foreground">{trace.toolName}</span>
                    <span className={`flex items-center gap-0.5 ${statusColor[status]}`}>
                      {statusIcon[status]}
                      {t(`builder.preview.tools.status.${status}`)}
                    </span>
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDuration(trace.durationMs)}
                    </span>
                    <span className="ml-auto truncate text-muted-foreground/60">
                      {new Date(trace.startedAt).toLocaleTimeString()}
                    </span>
                  </button>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="space-y-2 border-t border-border/60 px-2 py-1.5 text-[12px]">
                      <div>
                        <div className="mb-0.5 text-muted-foreground">
                          {t('builder.preview.tools.callId')}
                        </div>
                        <div className="font-mono text-foreground/80">{trace.callId}</div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-muted-foreground">
                          {t('builder.preview.tools.startedAt')}
                        </div>
                        <div className="font-mono text-foreground/80">{trace.startedAt}</div>
                      </div>
                      {trace.completedAt && (
                        <div>
                          <div className="mb-0.5 text-muted-foreground">
                            {t('builder.preview.tools.endedAt')}
                          </div>
                          <div className="font-mono text-foreground/80">
                            {trace.completedAt}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="mb-0.5 text-muted-foreground">
                          {t('builder.preview.tools.args')}
                        </div>
                        <pre className="max-h-40 overflow-auto rounded bg-muted/30 p-1.5 font-mono text-[12px] text-foreground/80">
                          {JSON.stringify(trace.arguments, null, 2)}
                        </pre>
                      </div>
                      {trace.result !== undefined && (
                        <div>
                          <div className="mb-0.5 text-muted-foreground">
                            {t('builder.preview.tools.result')}
                          </div>
                          <pre className="max-h-40 overflow-auto rounded bg-muted/30 p-1.5 font-mono text-[12px] text-foreground/80">
                            {typeof trace.result === 'string'
                              ? trace.result
                              : JSON.stringify(trace.result, null, 2)}
                          </pre>
                        </div>
                      )}
                      {trace.error && (
                        <div>
                          <div className="mb-0.5 text-destructive">
                            {t('builder.preview.tools.error')}
                          </div>
                          <pre className="max-h-40 overflow-auto rounded bg-destructive/10 p-1.5 font-mono text-[12px] text-destructive">
                            {trace.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default ToolCallTraceTab
