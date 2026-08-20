/**
 * 性能指标 Tab（MetricsTab）
 *
 * 通过 PreviewService.getMetrics() 拉取场景运行时的性能指标。
 *
 * 数据来源：
 *   - PreviewService.getMetrics()
 *   - 主进程通过 tryRunStartedAtMap + process.memoryUsage + fs.stat 收集
 *
 * 交互能力：
 *   - 手动刷新
 *   - 自动刷新（默认开启，每 5 秒拉取一次）
 *
 * 设计要点：
 *   - 字体 ≥ 12px
 *   - 指标按运行时 / 内存 / 数据库 / 工具调用 / IPC / 健康状态 分组展示
 *   - 健康状态用颜色区分：健康绿、降级黄、异常红
 *   - 内存 / 数据库大小使用人类可读格式
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../../services'
import type { PreviewMetrics } from '../../../services'
import {
  RefreshCw,
  Zap,
  ZapOff,
  Activity,
  Cpu,
  Database,
  Wrench,
  Server,
  Heart,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'

interface MetricsTabProps {
  /** 当前预览的 scenarioId */
  scenarioId: string | null
  /** 预览是否运行中 */
  running: boolean
}

const healthColor: Record<PreviewMetrics['healthStatus'], string> = {
  healthy: 'text-emerald-600',
  degraded: 'text-yellow-600',
  unhealthy: 'text-destructive',
}

const healthIcon: Record<PreviewMetrics['healthStatus'], React.ReactNode> = {
  healthy: <CheckCircle2 className="h-3 w-3" />,
  degraded: <AlertTriangle className="h-3 w-3" />,
  unhealthy: <XCircle className="h-3 w-3" />,
}

const MetricsTab: React.FC<MetricsTabProps> = ({ scenarioId, running }) => {
  const { t } = useI18n()
  const [metrics, setMetrics] = useState<PreviewMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchMetrics = useCallback(async () => {
    if (!scenarioId || !running) {
      setMetrics(null)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await previewService.getMetrics()
      if (!result.success || !result.metrics) {
        setError(result.error || t('builder.preview.metrics.loadFailed'))
        setMetrics(null)
        return
      }
      setMetrics(result.metrics)
    } catch (err) {
      setError((err as Error).message || t('builder.preview.metrics.loadFailed'))
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }, [scenarioId, running, t])

  useEffect(() => {
    void fetchMetrics()
    if (!autoRefresh || !running) return
    const timer = setInterval(() => {
      void fetchMetrics()
    }, 5000)
    return () => clearInterval(timer)
  }, [fetchMetrics, autoRefresh, running])

  const handleRefresh = useCallback(() => {
    void fetchMetrics()
  }, [fetchMetrics])

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1) return '<1ms'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
    if (minutes > 0) return `${minutes}m ${secs}s`
    return `${secs}s`
  }

  /** 指标卡片子组件 */
  const MetricGroup: React.FC<{
    title: string
    icon: React.ReactNode
    children: React.ReactNode
  }> = ({ title, icon, children }) => (
    <div className="rounded border border-border bg-background">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1 text-[12px] font-medium">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5 p-2">{children}</div>
    </div>
  )

  const MetricRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
    label,
    value,
    mono = true,
  }) => (
    <div className="flex justify-between gap-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-foreground/80 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            disabled={loading || !running}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            title={t('builder.preview.metrics.refresh')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('builder.preview.metrics.refresh')}
          </button>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] transition-colors ${
              autoRefresh
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            title={t('builder.preview.metrics.autoRefresh')}
          >
            {autoRefresh ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
            {t('builder.preview.metrics.autoRefresh')}
          </button>
        </div>
        {error && (
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-destructive">
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>

      {/* 主内容 */}
      <div className="flex-1 overflow-y-auto p-2">
        {!running || !scenarioId ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.metrics.notRunning')}
          </p>
        ) : !metrics ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground/60">-</p>
        ) : (
          <div className="space-y-2.5">
            {/* 健康状态 */}
            <div
              className={`flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-[12px] ${healthColor[metrics.healthStatus]}`}
            >
              <Heart className="h-3.5 w-3.5" />
              <span className="font-medium">{t('builder.preview.metrics.health')}</span>
              <span className={`flex items-center gap-0.5 ${healthColor[metrics.healthStatus]}`}>
                {healthIcon[metrics.healthStatus]}
                {t(`builder.preview.metrics.health.${metrics.healthStatus}`)}
              </span>
              {metrics.healthMessage && (
                <span className="ml-auto truncate text-muted-foreground" title={metrics.healthMessage}>
                  {metrics.healthMessage}
                </span>
              )}
            </div>

            {/* 运行时 */}
            <MetricGroup
              title={t('builder.preview.metrics.runtime')}
              icon={<Activity className="h-3.5 w-3.5 text-accent" />}
            >
              <MetricRow
                label={t('builder.preview.metrics.startedAt')}
                value={new Date(metrics.startedAt).toLocaleString()}
                mono={false}
              />
              <MetricRow
                label={t('builder.preview.metrics.uptime')}
                value={formatUptime(metrics.uptimeMs)}
              />
            </MetricGroup>

            {/* 内存 */}
            <MetricGroup
              title={t('builder.preview.metrics.memory')}
              icon={<Cpu className="h-3.5 w-3.5 text-accent" />}
            >
              <MetricRow
                label={t('builder.preview.metrics.memory')}
                value={formatBytes(metrics.memoryUsageBytes)}
              />
            </MetricGroup>

            {/* 数据库 */}
            <MetricGroup
              title={t('builder.preview.metrics.database')}
              icon={<Database className="h-3.5 w-3.5 text-accent" />}
            >
              <MetricRow
                label={t('builder.preview.metrics.databaseSize')}
                value={formatBytes(metrics.databaseSizeBytes)}
              />
              <MetricRow
                label={t('builder.preview.metrics.dbQueryCount')}
                value={String(metrics.dbQueryCount)}
              />
              <MetricRow
                label={t('builder.preview.metrics.avgDbQueryTime')}
                value={formatDuration(metrics.avgDbQueryDurationMs)}
              />
            </MetricGroup>

            {/* 工具调用 */}
            <MetricGroup
              title={t('builder.preview.metrics.toolCalls')}
              icon={<Wrench className="h-3.5 w-3.5 text-accent" />}
            >
              <MetricRow
                label={t('builder.preview.metrics.toolCallCount')}
                value={String(metrics.toolCallCount)}
              />
              <MetricRow
                label={t('builder.preview.metrics.toolCallSuccess')}
                value={String(metrics.toolCallSuccessCount)}
              />
              <MetricRow
                label={t('builder.preview.metrics.toolCallFailure')}
                value={String(metrics.toolCallFailureCount)}
              />
              <MetricRow
                label={t('builder.preview.metrics.avgToolCallTime')}
                value={formatDuration(metrics.avgToolCallDurationMs)}
              />
            </MetricGroup>

            {/* IPC */}
            <MetricGroup
              title={t('builder.preview.metrics.ipc')}
              icon={<Server className="h-3.5 w-3.5 text-accent" />}
            >
              <MetricRow
                label={t('builder.preview.metrics.activeIpcHandlers')}
                value={String(metrics.activeIpcHandlers)}
              />
            </MetricGroup>
          </div>
        )}
      </div>
    </div>
  )
}

export default MetricsTab
