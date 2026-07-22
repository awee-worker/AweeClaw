/**
 * 性能趋势图组件（阶段9 s9-08）
 *
 * 基于 MetricsChart 渲染 4 个趋势图：
 * 1. 读数速率趋势（readings/min）
 * 2. 错误率趋势（%）
 * 3. 已连接 Provider 数趋势
 * 4. 实体总数趋势
 *
 * 数据源：window.electronAPI.iot.getMetricsHistory(durationMs)
 * 时间范围切换：1h / 6h / 24h
 * 自动刷新：每 60s 拉取一次
 *
 * @module settings/tabs/iot/PerformanceTrendChart
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, LineChart } from 'lucide-react'
import { MetricsChart, type MetricSample } from '../monitoring/MetricsChart'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface PerformanceTrendChartProps {
  language: Language
}

/** 时间范围选项 */
type TrendRange = '1h' | '6h' | '24h'

/** 历史采样点（与 preload API 类型一致） */
interface HistorySample {
  timestamp: number
  globalReadingsPerMinute: number
  globalErrorRate: number
  connectedProviders: number
  totalProviders: number
  totalEntities: number
  uptimeSeconds: number
  windowReadings: number
  windowErrors: number
}

/** 自动刷新间隔（ms） */
const AUTO_REFRESH_INTERVAL_MS = 60_000

/** 时间范围对应的毫秒数 */
const RANGE_MS: Record<TrendRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

/** 时间范围选项标签 */
const RANGE_OPTIONS: Array<{ value: TrendRange; labelZh: string; labelEn: string }> = [
  { value: '1h', labelZh: '1 小时', labelEn: '1 hour' },
  { value: '6h', labelZh: '6 小时', labelEn: '6 hours' },
  { value: '24h', labelZh: '24 小时', labelEn: '24 hours' },
]

export function PerformanceTrendChart({ language }: PerformanceTrendChartProps) {
  const isZh = language === 'zh'
  const [range, setRange] = useState<TrendRange>('24h')
  const [samples, setSamples] = useState<HistorySample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  /** 拉取历史趋势数据 */
  const fetchHistory = useCallback(async (selectedRange: TrendRange) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.iot.getMetricsHistory(RANGE_MS[selectedRange])
      if (result.success && result.data) {
        setSamples(result.data as HistorySample[])
      } else {
        setError(result.error ?? (isZh ? '获取历史趋势失败' : 'Failed to fetch history'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('[PerformanceTrendChart] 拉取历史趋势失败:', e)
    } finally {
      setLoading(false)
    }
  }, [isZh])

  /** 切换时间范围 */
  const handleRangeChange = useCallback((newRange: TrendRange) => {
    setRange(newRange)
    void fetchHistory(newRange)
  }, [fetchHistory])

  // 初始加载 + range 变化时刷新
  useEffect(() => {
    void fetchHistory(range)
  }, [range, fetchHistory])

  // 自动刷新定时器
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      void fetchHistory(range)
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [range, fetchHistory])

  // 将历史采样转换为各指标的 MetricSample 数组
  const chartData = useMemo(() => {
    const readings: MetricSample[] = samples.map((s) => ({
      timestamp: s.timestamp,
      value: s.globalReadingsPerMinute,
    }))
    const errorRate: MetricSample[] = samples.map((s) => ({
      timestamp: s.timestamp,
      value: s.globalErrorRate * 100, // 转换为百分比
    }))
    const connected: MetricSample[] = samples.map((s) => ({
      timestamp: s.timestamp,
      value: s.connectedProviders,
    }))
    const entities: MetricSample[] = samples.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalEntities,
    }))
    return { readings, errorRate, connected, entities }
  }, [samples])

  // 错误率警告/严重阈值（百分比）
  const errorRateWarning = 10
  const errorRateCritical = 30

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-accent" />
          <h4 className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider">
            {isZh ? '24h 历史趋势' : '24h Trend'}
          </h4>
          <span className="text-[12px] text-text-muted">
            {isZh
              ? `${samples.length} 个采样点`
              : `${samples.length} samples`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 时间范围切换 */}
          <div className="flex items-center gap-1 p-0.5 bg-surface/40 rounded-lg border border-border/40">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleRangeChange(opt.value)}
                className={`px-2.5 py-1 rounded text-[12px] font-medium transition-all ${
                  range === opt.value
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                {isZh ? opt.labelZh : opt.labelEn}
              </button>
            ))}
          </div>

          {/* 手动刷新 */}
          <button
            onClick={() => void fetchHistory(range)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-surface/40 text-text-secondary border border-border/40 hover:bg-surface-hover transition-all disabled:opacity-50"
            title={isZh ? '刷新' : 'Refresh'}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500">
          {error}
        </div>
      )}

      {/* 空数据提示 */}
      {!error && samples.length === 0 && !loading && (
        <div className="text-center py-8 text-text-secondary text-[12px]">
          {isZh
            ? '暂无历史数据（Bridge 启动后每分钟采样一次）'
            : 'No history data yet (samples every minute after Bridge starts)'}
        </div>
      )}

      {/* 4 个趋势图 */}
      {samples.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricsChart
            title={isZh ? '读数速率' : 'Readings Rate'}
            samples={chartData.readings}
            unit=" /min"
            color="#8b5cf6"
            language={language}
          />
          <MetricsChart
            title={isZh ? '错误率' : 'Error Rate'}
            samples={chartData.errorRate}
            warningThreshold={errorRateWarning}
            criticalThreshold={errorRateCritical}
            unit="%"
            color="#ef4444"
            language={language}
          />
          <MetricsChart
            title={isZh ? '已连接 Provider' : 'Connected Providers'}
            samples={chartData.connected}
            color="#10b981"
            language={language}
          />
          <MetricsChart
            title={isZh ? '实体总数' : 'Total Entities'}
            samples={chartData.entities}
            color="#06b6d4"
            language={language}
          />
        </div>
      )}
    </div>
  )
}
