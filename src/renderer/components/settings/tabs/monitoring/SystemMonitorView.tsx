/**
 * 系统监控主视图
 *
 * 全屏弹窗，整合：
 * - 实时指标卡片网格
 * - 历史曲线图（CPU/内存/磁盘/网络）
 * - 异常告警列表
 * - 时间范围切换（最近 1h / 6h / 24h）
 * - 自动刷新（每 30s）
 * - 异常事件订阅（实时推送新告警）
 *
 * 用户在 PerceptionSettingsPanel 中点击「系统监控」按钮打开。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  Power,
} from 'lucide-react'
import { OverlayDialog } from '@components/ui'
import { ToggleSwitch } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { MetricsGridPanel, type MetricsSnapshot } from './MetricsGridPanel'
import { MetricsChart, type MetricSample } from './MetricsChart'
import { AnomalyListPanel, type AnomalyEventItem } from './AnomalyListPanel'

interface SystemMonitorViewProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
}

/** 时间范围选项 */
type TimeRange = 1 | 6 | 24

/** 监控配置（精简版） */
interface MonitorConfig {
  enabled: boolean
  sampleIntervalSec: number
  anomalyDetectionEnabled: boolean
  predictiveAlertEnabled: boolean
  notificationsEnabled: boolean
  cloudReportingEnabled: boolean
  thresholds: {
    cpuWarning: number
    cpuCritical: number
    memoryWarning: number
    memoryCritical: number
    diskWarning: number
    diskCritical: number
    temperatureWarning: number
    temperatureCritical: number
    batteryLow: number
    processExplosion: number
  }
}

/** 默认配置（在 IPC 返回前使用） */
const DEFAULT_CONFIG: MonitorConfig = {
  enabled: false,
  sampleIntervalSec: 30,
  anomalyDetectionEnabled: true,
  predictiveAlertEnabled: true,
  notificationsEnabled: true,
  cloudReportingEnabled: false,
  thresholds: {
    cpuWarning: 80,
    cpuCritical: 95,
    memoryWarning: 85,
    memoryCritical: 95,
    diskWarning: 85,
    diskCritical: 95,
    temperatureWarning: 80,
    temperatureCritical: 90,
    batteryLow: 20,
    processExplosion: 500,
  },
}

export function SystemMonitorView({
  isOpen,
  onClose,
  language,
}: SystemMonitorViewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(1)
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG)
  const [latestMetrics, setLatestMetrics] = useState<MetricsSnapshot | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyEventItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // 自动刷新定时器
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 异常事件订阅取消函数
  const unsubscribeAnomaliesRef = useRef<(() => void) | null>(null)

  /** 加载监控配置 */
  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.monitoring.getConfig()
      if (result.success && result.data) {
        setConfig(result.data as MonitorConfig)
      }
      const runRes = await window.electronAPI.monitoring.isRunning()
      if (runRes.success && typeof runRes.data === 'boolean') {
        setIsRunning(runRes.data)
      }
    } catch (e) {
      logger.settings?.error('[SystemMonitorView] 加载配置失败:', e)
    }
  }, [])

  /** 加载最新指标 */
  const loadLatestMetrics = useCallback(async () => {
    try {
      const result = await window.electronAPI.monitoring.getLatestMetrics()
      if (result.success) {
        setLatestMetrics((result.data as MetricsSnapshot) ?? null)
      }
    } catch (e) {
      logger.settings?.error('[SystemMonitorView] 加载最新指标失败:', e)
    }
  }, [])

  /** 加载历史指标 */
  const loadHistoryMetrics = useCallback(async (range: TimeRange) => {
    setLoading(true)
    setError(null)
    try {
      const now = Date.now()
      const startTime = now - range * 60 * 60 * 1000
      const result = await window.electronAPI.monitoring.getMetricsByTimeRange(
        startTime,
        now,
        2000,
      )
      if (result.success) {
        setMetricsHistory((result.data as MetricsSnapshot[]) ?? [])
      } else {
        throw new Error(result.error || 'Failed to load metrics')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.settings?.error('[SystemMonitorView] 加载历史指标失败:', e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载异常列表 */
  const loadAnomalies = useCallback(async () => {
    try {
      const result = await window.electronAPI.monitoring.getActiveAnomalies()
      if (result.success) {
        const items = (result.data as AnomalyEventItem[]) ?? []
        // 时间倒序
        items.sort((a, b) => b.timestamp - a.timestamp)
        setAnomalies(items)
      }
    } catch (e) {
      logger.settings?.error('[SystemMonitorView] 加载异常列表失败:', e)
    }
  }, [])

  /** 切换监控开关 */
  const toggleMonitoring = useCallback(async (enabled: boolean) => {
    try {
      const result = await window.electronAPI.monitoring.updateConfig({ enabled })
      if (result.success) {
        setConfig((prev) => ({ ...prev, enabled }))
        const runRes = await window.electronAPI.monitoring.isRunning()
        if (runRes.success && typeof runRes.data === 'boolean') {
          setIsRunning(runRes.data)
        }
      }
    } catch (e) {
      logger.settings?.error('[SystemMonitorView] 切换监控失败:', e)
    }
  }, [])

  /** 订阅异常事件推送 */
  const subscribeAnomalyEvents = useCallback(async () => {
    try {
      // 先调用 subscribe 触发主进程订阅
      await window.electronAPI.monitoring.subscribe()
      // 注册渲染层监听
      unsubscribeAnomaliesRef.current = window.electronAPI.monitoring.onAnomalyEvent((event) => {
        const newAnomaly = event as AnomalyEventItem
        setAnomalies((prev) => {
          // 去重：如果已存在则不重复添加
          if (prev.some((a) => a.id === newAnomaly.id)) return prev
          // 添加到列表头部
          return [newAnomaly, ...prev].slice(0, 100)
        })
      })
    } catch (e) {
      logger.settings?.error('[SystemMonitorView] 订阅异常事件失败:', e)
    }
  }, [])

  // 初始加载 + 订阅
  useEffect(() => {
    if (!isOpen) return
    void loadConfig()
    void loadLatestMetrics()
    void loadHistoryMetrics(timeRange)
    void loadAnomalies()
    void subscribeAnomalyEvents()

    // 自动刷新：每 30s 拉取最新指标 + 异常列表
    refreshTimerRef.current = setInterval(() => {
      void loadLatestMetrics()
      void loadAnomalies()
    }, 30_000)

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      if (unsubscribeAnomaliesRef.current) {
        unsubscribeAnomaliesRef.current()
        unsubscribeAnomaliesRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // 时间范围变化重新加载历史
  useEffect(() => {
    if (isOpen) {
      void loadHistoryMetrics(timeRange)
    }
  }, [isOpen, timeRange, loadHistoryMetrics])

  // 提取各指标的采样序列
  const chartData = useMemo(() => {
    const cpu: MetricSample[] = metricsHistory.map((m) => ({ timestamp: m.timestamp, value: m.cpuUsage }))
    const memory: MetricSample[] = metricsHistory.map((m) => ({ timestamp: m.timestamp, value: m.memoryUsage }))
    const disk: MetricSample[] = metricsHistory.map((m) => ({ timestamp: m.timestamp, value: m.diskUsage }))
    const network: MetricSample[] = metricsHistory.map((m) => ({
      timestamp: m.timestamp,
      value: (m.networkRxKBps + m.networkTxKBps) / 1024,
    }))
    return { cpu, memory, disk, network }
  }, [metricsHistory])

  // 活跃异常数量
  const activeAnomalyCount = useMemo(
    () => anomalies.filter((a) => a.status === 'active').length,
    [anomalies],
  )

  const timeRangeOptions: Array<{ value: TimeRange; labelKey: string }> = [
    { value: 1, labelKey: 'monitoring.range.last1h' },
    { value: 6, labelKey: 'monitoring.range.last6h' },
    { value: 24, labelKey: 'monitoring.range.last24h' },
  ]

  return (
    <OverlayDialog isOpen={isOpen} onClose={onClose} size="5xl">
      <div className="p-6 space-y-5">
        {/* 顶部：标题 + 监控开关 + 时间范围切换 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-text-primary">
                {t('monitoring.title', language)}
              </h3>
              {/* 监控开关 */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-surface/40 border border-border/40">
                <Power className={`w-3.5 h-3.5 ${isRunning ? 'text-emerald-500' : 'text-text-muted'}`} />
                <span className="text-[12px] text-text-secondary">
                  {t('monitoring.toggle', language)}
                </span>
                <ToggleSwitch
                  checked={config.enabled}
                  onChange={(e) => void toggleMonitoring(e.target.checked)}
                />
              </div>
            </div>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('monitoring.subtitle', language)}
            </p>
          </div>

          {/* 时间范围切换 */}
          <div className="flex items-center gap-1 p-1 bg-surface/40 rounded-xl border border-border/40">
            {timeRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  timeRange === opt.value
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                {t(opt.labelKey, language)}
              </button>
            ))}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-500">
                {t('monitoring.loadError', language)}
              </div>
              <div className="text-[12px] text-red-500/70 mt-0.5 break-all">{error}</div>
            </div>
            <button
              onClick={() => void loadHistoryMetrics(timeRange)}
              className="text-[12px] text-red-500 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-500/10"
            >
              <RefreshCw className="w-3 h-3" />
              {t('monitoring.retry', language)}
            </button>
          </div>
        )}

        {/* 实时指标卡片 */}
        <section>
          <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-3">
            {t('monitoring.sections.realtime', language)}
          </h4>
          <MetricsGridPanel
            metrics={latestMetrics}
            thresholds={config.thresholds}
            language={language}
          />
        </section>

        {/* 历史曲线 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
              {t('monitoring.sections.history', language)}
            </h4>
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                <div className="w-3 h-3 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
                {t('monitoring.loading', language)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <MetricsChart
              title={t('monitoring.chart.cpu', language)}
              samples={chartData.cpu}
              warningThreshold={config.thresholds.cpuWarning}
              criticalThreshold={config.thresholds.cpuCritical}
              unit="%"
              color="#8b5cf6"
              language={language}
            />
            <MetricsChart
              title={t('monitoring.chart.memory', language)}
              samples={chartData.memory}
              warningThreshold={config.thresholds.memoryWarning}
              criticalThreshold={config.thresholds.memoryCritical}
              unit="%"
              color="#06b6d4"
              language={language}
            />
            <MetricsChart
              title={t('monitoring.chart.disk', language)}
              samples={chartData.disk}
              warningThreshold={config.thresholds.diskWarning}
              criticalThreshold={config.thresholds.diskCritical}
              unit="%"
              color="#10b981"
              language={language}
            />
            <MetricsChart
              title={t('monitoring.chart.network', language)}
              samples={chartData.network}
              unit="MB/s"
              color="#f59e0b"
              language={language}
            />
          </div>
        </section>

        {/* 异常告警列表 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 flex items-center gap-2">
              {t('monitoring.sections.anomalies', language)}
              {activeAnomalyCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] bg-red-500/20 text-red-500 border border-red-500/40">
                  <AlertTriangle className="w-3 h-3" />
                  {activeAnomalyCount}
                </span>
              )}
            </h4>
            <button
              onClick={() => void loadAnomalies()}
              className="text-[12px] text-text-secondary hover:text-text-primary flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-hover"
            >
              <RefreshCw className="w-3 h-3" />
              {t('monitoring.refresh', language)}
            </button>
          </div>
          <div className="p-4 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40">
            <AnomalyListPanel
              anomalies={anomalies}
              language={language}
              onStatusChange={() => void loadAnomalies()}
            />
          </div>
        </section>
      </div>
    </OverlayDialog>
  )
}
