/**
 * IoT 性能指标面板 — 阶段8 s8-08
 *
 * 功能：
 * - 展示 Bridge 整体运行指标（运行时长、读数速率、错误率、连接数）
 * - 按协议聚合展示（homeassistant/mqtt/ble/custom）
 * - Provider 明细列表（含窗口内速率、错误率、停滞检测）
 * - 时间窗口切换（1m/5m/1h）
 * - 自动刷新（5 秒间隔，可暂停）
 *
 * 数据流：
 * - IPC window.electronAPI.iot.getMetrics() 拉取指标快照
 * - IPC window.electronAPI.iot.setMetricsWindow() 切换窗口
 *
 * @module settings/tabs/iot/PerformancePanel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  Timer,
  Zap,
} from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { PerformanceTrendChart } from './PerformanceTrendChart'

interface PerformancePanelProps {
  language: Language
  refreshKey: number
}

// ============================================================
// 类型定义（与 preload/api/iot.ts 一致）
// ============================================================

type MetricsWindow = '1m' | '5m' | '1h'

interface ProviderMetrics {
  providerId: string
  providerName: string
  protocol: 'homeassistant' | 'mqtt' | 'ble' | 'custom'
  state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled'
  totalReadings: number
  totalErrors: number
  totalStateChanges: number
  lastReadingAt: number | null
  lastErrorAt: number | null
  lastConnectedAt: number | null
  windowReadings: number
  windowErrors: number
  readingsPerMinute: number
  errorRate: number
  uptimeSeconds: number
  secondsSinceLastReading: number | null
}

interface ProtocolMetrics {
  protocol: 'homeassistant' | 'mqtt' | 'ble' | 'custom'
  providerCount: number
  connectedCount: number
  errorCount: number
  totalReadings: number
  totalErrors: number
}

interface BridgeMetrics {
  collectedAt: number
  startedAt: number | null
  uptimeSeconds: number
  totalReadings: number
  totalErrors: number
  totalStateChanges: number
  windowReadings: number
  windowErrors: number
  globalReadingsPerMinute: number
  globalErrorRate: number
  connectedProviders: number
  totalProviders: number
  totalEntities: number
  providers: ProviderMetrics[]
  protocols: ProtocolMetrics[]
}

// ============================================================
// 常量
// ============================================================

/** 自动刷新间隔（毫秒） */
const AUTO_REFRESH_INTERVAL_MS = 5000

/** 时间窗口选项 */
const WINDOW_OPTIONS: Array<{ value: MetricsWindow; labelZh: string; labelEn: string }> = [
  { value: '1m', labelZh: '1 分钟', labelEn: '1 min' },
  { value: '5m', labelZh: '5 分钟', labelEn: '5 min' },
  { value: '1h', labelZh: '1 小时', labelEn: '1 hour' },
]

/** 协议显示名称 */
const PROTOCOL_LABELS: Record<string, { zh: string; en: string }> = {
  homeassistant: { zh: 'Home Assistant', en: 'Home Assistant' },
  mqtt: { zh: 'MQTT', en: 'MQTT' },
  ble: { zh: 'BLE', en: 'BLE' },
  custom: { zh: '自定义', en: 'Custom' },
}

/** 停滞检测阈值（秒，超过此值视为数据流停滞） */
const STALE_THRESHOLD_SECONDS = 120

// ============================================================
// 组件
// ============================================================

export function PerformancePanel({ language, refreshKey }: PerformancePanelProps) {
  const isZh = language === 'zh'

  const [metrics, setMetrics] = useState<BridgeMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [windowState, setWindowState] = useState<MetricsWindow>('5m')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  /** 拉取指标 */
  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.iot.getMetrics()
      if (result.success && result.data) {
        setMetrics(result.data as BridgeMetrics)
      } else {
        setError(result.error || (isZh ? '获取指标失败' : 'Failed to fetch metrics'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('Failed to fetch IoT metrics:', e)
    } finally {
      setLoading(false)
    }
  }, [isZh])

  /** 切换时间窗口 */
  const handleWindowChange = useCallback(
    async (newWindow: MetricsWindow) => {
      setWindowState(newWindow)
      try {
        await window.electronAPI.iot.setMetricsWindow(newWindow)
        await fetchMetrics()
      } catch (e) {
        logger.settings?.error('Failed to set metrics window:', e)
      }
    },
    [fetchMetrics],
  )

  /** 初始加载 + refreshKey 变化时刷新 */
  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics, refreshKey])

  /** 自动刷新定时器 */
  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      return
    }

    refreshTimerRef.current = setInterval(() => {
      fetchMetrics()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [autoRefresh, fetchMetrics])

  return (
    <div className="p-5 space-y-5">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">
            {isZh ? '性能指标' : 'Performance Metrics'}
          </h3>
          {metrics && (
            <span className="text-[12px] text-text-secondary">
              {isZh
                ? `采集于 ${new Date(metrics.collectedAt).toLocaleTimeString()}`
                : `Collected at ${new Date(metrics.collectedAt).toLocaleTimeString()}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 时间窗口切换 */}
          <div className="flex items-center gap-1 p-0.5 bg-surface/40 rounded-lg border border-border/40">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleWindowChange(opt.value)}
                className={`px-2.5 py-1 rounded text-[12px] font-medium transition-all ${
                  windowState === opt.value
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                {isZh ? opt.labelZh : opt.labelEn}
              </button>
            ))}
          </div>

          {/* 自动刷新切换 */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-all ${
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                : 'bg-surface/40 text-text-secondary border-border/40 hover:bg-surface-hover'
            }`}
            title={isZh ? '切换自动刷新' : 'Toggle auto-refresh'}
          >
            {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {autoRefresh ? (isZh ? '自动' : 'Auto') : (isZh ? '手动' : 'Manual')}
          </button>

          {/* 手动刷新 */}
          <button
            onClick={fetchMetrics}
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
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!metrics ? (
        <div className="text-center py-10 text-text-secondary text-sm">
          {loading
            ? isZh
              ? '加载中...'
              : 'Loading...'
            : isZh
              ? '暂无指标数据'
              : 'No metrics available'}
        </div>
      ) : (
        <>
          {/* 全局指标卡片 */}
          <GlobalMetricsCard metrics={metrics} isZh={isZh} />

          {/* 协议聚合 */}
          {metrics.protocols.length > 0 && (
            <ProtocolAggregation protocols={metrics.protocols} isZh={isZh} />
          )}

          {/* Provider 明细 */}
          <ProviderMetricsTable providers={metrics.providers} isZh={isZh} />

          {/* 24h 历史趋势图（阶段9 s9-08） */}
          <PerformanceTrendChart language={language} />
        </>
      )}
    </div>
  )
}

// ============================================================
// 子组件：全局指标卡片
// ============================================================

interface GlobalMetricsCardProps {
  metrics: BridgeMetrics
  isZh: boolean
}

function GlobalMetricsCard({ metrics, isZh }: GlobalMetricsCardProps) {
  const uptimeStr = formatDuration(metrics.uptimeSeconds, isZh)
  const errorRatePercent = (metrics.globalErrorRate * 100).toFixed(2)
  const errorRateColor =
    metrics.globalErrorRate < 0.01
      ? 'text-emerald-500'
      : metrics.globalErrorRate < 0.1
        ? 'text-amber-500'
        : 'text-red-500'

  const stats = [
    {
      icon: Clock,
      label: isZh ? '运行时长' : 'Uptime',
      value: uptimeStr,
      color: 'text-text-primary',
    },
    {
      icon: Activity,
      label: isZh ? '读数速率' : 'Readings/min',
      value: metrics.globalReadingsPerMinute.toFixed(1),
      color: 'text-accent',
    },
    {
      icon: Zap,
      label: isZh ? '窗口读数' : 'Window readings',
      value: String(metrics.windowReadings),
      color: 'text-text-primary',
    },
    {
      icon: AlertCircle,
      label: isZh ? '错误率' : 'Error rate',
      value: `${errorRatePercent}%`,
      color: errorRateColor,
    },
    {
      icon: CheckCircle2,
      label: isZh ? '已连接 Provider' : 'Connected',
      value: `${metrics.connectedProviders}/${metrics.totalProviders}`,
      color: metrics.connectedProviders === metrics.totalProviders && metrics.totalProviders > 0
        ? 'text-emerald-500'
        : 'text-text-primary',
    },
    {
      icon: Gauge,
      label: isZh ? '实体总数' : 'Entities',
      value: String(metrics.totalEntities),
      color: 'text-text-primary',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="p-3 bg-surface/30 rounded-xl border border-border/40 flex flex-col gap-1"
        >
          <div className="flex items-center gap-1.5 text-text-secondary">
            <stat.icon className="w-3.5 h-3.5" />
            <span className="text-[12px]">{stat.label}</span>
          </div>
          <span className={`text-lg font-semibold ${stat.color}`}>
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// 子组件：协议聚合
// ============================================================

interface ProtocolAggregationProps {
  protocols: ProtocolMetrics[]
  isZh: boolean
}

function ProtocolAggregation({ protocols, isZh }: ProtocolAggregationProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider">
        {isZh ? '协议聚合' : 'Protocol Aggregation'}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {protocols.map((p) => {
          const labels = PROTOCOL_LABELS[p.protocol] || { zh: p.protocol, en: p.protocol }
          const allConnected = p.connectedCount === p.providerCount && p.providerCount > 0
          const hasError = p.errorCount > 0

          return (
            <div
              key={p.protocol}
              className={`p-3 rounded-xl border ${
                hasError
                  ? 'bg-red-500/5 border-red-500/20'
                  : allConnected
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-surface/30 border-border/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-text-primary">
                  {isZh ? labels.zh : labels.en}
                </span>
                <span
                  className={`text-[12px] ${
                    hasError
                      ? 'text-red-500'
                      : allConnected
                        ? 'text-emerald-500'
                        : 'text-text-secondary'
                  }`}
                >
                  {p.connectedCount}/{p.providerCount}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <div className="text-text-secondary">{isZh ? '读数' : 'Readings'}</div>
                  <div className="text-text-primary font-medium">{p.totalReadings}</div>
                </div>
                <div>
                  <div className="text-text-secondary">{isZh ? '错误' : 'Errors'}</div>
                  <div className={p.totalErrors > 0 ? 'text-red-500 font-medium' : 'text-text-primary font-medium'}>
                    {p.totalErrors}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 子组件：Provider 指标表格
// ============================================================

interface ProviderMetricsTableProps {
  providers: ProviderMetrics[]
  isZh: boolean
}

function ProviderMetricsTable({ providers, isZh }: ProviderMetricsTableProps) {
  if (providers.length === 0) {
    return (
      <div className="text-center py-6 text-text-secondary text-[12px]">
        {isZh ? '暂无 Provider 指标' : 'No provider metrics'}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider">
        {isZh ? 'Provider 明细' : 'Provider Details'}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-text-secondary border-b border-border/40">
              <th className="text-left py-2 px-2 font-medium">
                {isZh ? 'Provider' : 'Provider'}
              </th>
              <th className="text-left py-2 px-2 font-medium">
                {isZh ? '协议' : 'Protocol'}
              </th>
              <th className="text-left py-2 px-2 font-medium">
                {isZh ? '状态' : 'State'}
              </th>
              <th className="text-right py-2 px-2 font-medium">
                {isZh ? '速率/分' : 'Rate/min'}
              </th>
              <th className="text-right py-2 px-2 font-medium">
                {isZh ? '窗口读数' : 'Window'}
              </th>
              <th className="text-right py-2 px-2 font-medium">
                {isZh ? '错误率' : 'Error rate'}
              </th>
              <th className="text-right py-2 px-2 font-medium">
                {isZh ? '累计读数' : 'Total'}
              </th>
              <th className="text-left py-2 px-2 font-medium">
                {isZh ? '最近读数' : 'Last reading'}
              </th>
              <th className="text-left py-2 px-2 font-medium">
                {isZh ? '运行时长' : 'Uptime'}
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const labels = PROTOCOL_LABELS[p.protocol] || { zh: p.protocol, en: p.protocol }
              const isStale = isProviderStale(p)
              const errorRatePercent = (p.errorRate * 100).toFixed(1)

              return (
                <tr
                  key={p.providerId}
                  className="border-b border-border/20 hover:bg-surface-hover/30"
                >
                  <td className="py-2 px-2">
                    <div className="font-medium text-text-primary">{p.providerName}</div>
                    <div className="text-text-secondary text-[11px]">{p.providerId}</div>
                  </td>
                  <td className="py-2 px-2 text-text-secondary">
                    {isZh ? labels.zh : labels.en}
                  </td>
                  <td className="py-2 px-2">
                    <StateBadge state={p.state} isStale={isStale} isZh={isZh} />
                  </td>
                  <td className="text-right py-2 px-2 text-text-primary font-mono">
                    {p.readingsPerMinute.toFixed(1)}
                  </td>
                  <td className="text-right py-2 px-2 text-text-primary font-mono">
                    {p.windowReadings}
                  </td>
                  <td className={`text-right py-2 px-2 font-mono ${
                    p.errorRate >= 0.1
                      ? 'text-red-500'
                      : p.errorRate > 0
                        ? 'text-amber-500'
                        : 'text-text-primary'
                  }`}>
                    {errorRatePercent}%
                  </td>
                  <td className="text-right py-2 px-2 text-text-secondary font-mono">
                    {p.totalReadings}
                  </td>
                  <td className="py-2 px-2">
                    {p.lastReadingAt ? (
                      <span className={isStale ? 'text-red-500' : 'text-text-secondary'}>
                        {formatRelativeTime(p.lastReadingAt, isZh)}
                      </span>
                    ) : (
                      <span className="text-text-secondary">-</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-text-secondary">
                    {p.uptimeSeconds > 0 ? formatDuration(p.uptimeSeconds, isZh) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================
// 子组件：状态徽章
// ============================================================

interface StateBadgeProps {
  state: ProviderMetrics['state']
  isStale: boolean
  isZh: boolean
}

function StateBadge({ state, isStale, isZh }: StateBadgeProps) {
  // 优先显示停滞状态
  if (isStale && state === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-500">
        <Timer className="w-3 h-3" />
        {isZh ? '停滞' : 'Stale'}
      </span>
    )
  }

  const config: Record<ProviderMetrics['state'], { zh: string; en: string; className: string }> = {
    connected: {
      zh: '已连接',
      en: 'Connected',
      className: 'bg-emerald-500/15 text-emerald-500',
    },
    connecting: {
      zh: '连接中',
      en: 'Connecting',
      className: 'bg-blue-500/15 text-blue-500',
    },
    disconnected: {
      zh: '已断开',
      en: 'Disconnected',
      className: 'bg-surface/40 text-text-secondary',
    },
    error: {
      zh: '异常',
      en: 'Error',
      className: 'bg-red-500/15 text-red-500',
    },
    disabled: {
      zh: '已禁用',
      en: 'Disabled',
      className: 'bg-surface/40 text-text-secondary',
    },
  }

  const c = config[state]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${c.className}`}>
      {state === 'connected' && <CheckCircle2 className="w-3 h-3" />}
      {state === 'error' && <AlertCircle className="w-3 h-3" />}
      {isZh ? c.zh : c.en}
    </span>
  )
}

// ============================================================
// 辅助函数
// ============================================================

/** 判断 Provider 是否停滞（已连接但超过阈值未收到读数） */
function isProviderStale(p: ProviderMetrics): boolean {
  if (p.state !== 'connected') return false
  if (p.secondsSinceLastReading === null) return false
  return p.secondsSinceLastReading > STALE_THRESHOLD_SECONDS
}

/** 格式化时长（秒 → 人类可读） */
function formatDuration(seconds: number, isZh: boolean): string {
  if (seconds <= 0) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  if (h > 0) {
    return isZh ? `${h}时${m}分` : `${h}h ${m}m`
  }
  if (m > 0) {
    return isZh ? `${m}分${s}秒` : `${m}m ${s}s`
  }
  return isZh ? `${s}秒` : `${s}s`
}

/** 格式化相对时间（"3秒前"、"2分钟前"） */
function formatRelativeTime(timestamp: number, isZh: boolean): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 5) return isZh ? '刚刚' : 'just now'
  if (diff < 60) return isZh ? `${diff}秒前` : `${diff}s ago`
  if (diff < 3600) return isZh ? `${Math.floor(diff / 60)}分钟前` : `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return isZh ? `${Math.floor(diff / 3600)}小时前` : `${Math.floor(diff / 3600)}h ago`
  return new Date(timestamp).toLocaleString()
}
