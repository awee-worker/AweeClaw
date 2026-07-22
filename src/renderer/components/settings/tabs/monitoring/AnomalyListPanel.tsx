/**
 * 异常告警列表组件
 *
 * 展示异常事件列表，支持：
 * - 按严重度（critical/warning/info）颜色编码
 * - 按状态（active/acknowledged/resolved）图标标记
 * - 点击"已知晓"按钮 → acknowledgeAnomaly
 * - 点击"标记已解决"按钮 → resolveAnomaly
 * - 时间倒序排列
 * - 严重度筛选
 */

import { memo, useState, useCallback } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  Clock,
  TrendingUp,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

/** 异常事件（与 preload api 类型一致） */
export interface AnomalyEventItem {
  id: string
  timestamp: number
  type: string
  severity: 'info' | 'warning' | 'critical'
  metricType: string
  currentValue: number
  predictedPeak?: number
  predictedTriggerAt?: number
  description: string
  recommendation: string
  status: 'active' | 'resolved' | 'acknowledged'
}

interface AnomalyListPanelProps {
  /** 异常列表 */
  anomalies: AnomalyEventItem[]
  /** 语言 */
  language: Language
  /** 状态变化回调（确认/解决后触发） */
  onStatusChange?: () => void
}

/** 严重度样式 */
const SEVERITY_STYLES = {
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: <AlertCircle className="w-4 h-4 text-red-500" />,
    badge: 'bg-red-500/20 text-red-500 border-red-500/40',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    badge: 'bg-amber-500/20 text-amber-500 border-amber-500/40',
  },
  info: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: <Info className="w-4 h-4 text-cyan-500" />,
    badge: 'bg-cyan-500/20 text-cyan-500 border-cyan-500/40',
  },
} as const

/** 状态图标 */
function StatusBadge({ status, language }: { status: AnomalyEventItem['status']; language: Language }) {
  if (status === 'resolved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] bg-emerald-500/20 text-emerald-500 border border-emerald-500/40">
        <CheckCircle className="w-3 h-3" />
        {t('monitoring.anomaly.resolved', language)}
      </span>
    )
  }
  if (status === 'acknowledged') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] bg-slate-500/20 text-slate-400 border border-slate-500/40">
        <CheckCircle className="w-3 h-3" />
        {t('monitoring.anomaly.acknowledged', language)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] bg-orange-500/20 text-orange-500 border border-orange-500/40">
      <Clock className="w-3 h-3" />
      {t('monitoring.anomaly.active', language)}
    </span>
  )
}

/** 时间格式化 */
function formatRelativeTime(ts: number, language: Language): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (language === 'zh') {
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    if (hours < 24) return `${hours} 小时前`
    if (days < 30) return `${days} 天前`
    return new Date(ts).toLocaleString('zh-CN')
  }

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleString('en-US')
}

export const AnomalyListPanel = memo(function AnomalyListPanel({
  anomalies,
  language,
  onStatusChange,
}: AnomalyListPanelProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'critical'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleAcknowledge = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await window.electronAPI.monitoring.acknowledgeAnomaly(id)
      onStatusChange?.()
    } catch (e) {
      logger.ui?.error('[AnomalyListPanel] 确认异常失败:', e)
    } finally {
      setBusyId(null)
    }
  }, [onStatusChange])

  const handleResolve = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await window.electronAPI.monitoring.resolveAnomaly(id)
      onStatusChange?.()
    } catch (e) {
      logger.ui?.error('[AnomalyListPanel] 解决异常失败:', e)
    } finally {
      setBusyId(null)
    }
  }, [onStatusChange])

  // 筛选
  const filtered = anomalies.filter((a) => {
    if (filter === 'active') return a.status === 'active'
    if (filter === 'critical') return a.severity === 'critical'
    return true
  })

  return (
    <div className="space-y-3">
      {/* 筛选器 */}
      <div className="flex items-center gap-2">
        {(['all', 'active', 'critical'] as const).map((f) => {
          const labels: Record<typeof f, string> = {
            all: t('monitoring.anomaly.filterAll', language),
            active: t('monitoring.anomaly.filterActive', language),
            critical: t('monitoring.anomaly.filterCritical', language),
          }
          const counts: Record<typeof f, number> = {
            all: anomalies.length,
            active: anomalies.filter((a) => a.status === 'active').length,
            critical: anomalies.filter((a) => a.severity === 'critical').length,
          }
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                filter === f
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {labels[f]}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                filter === f ? 'bg-white/20' : 'bg-surface/40'
              }`}>
                {counts[f]}
              </span>
            </button>
          )
        })}
      </div>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-text-muted">
          <CheckCircle className="w-8 h-8 mb-2 text-emerald-500/60" />
          <p className="text-sm">{t('monitoring.anomaly.empty', language)}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
          {filtered.map((anomaly) => {
            const style = SEVERITY_STYLES[anomaly.severity]
            return (
              <div
                key={anomaly.id}
                className={`p-3 rounded-xl border ${style.bg} ${style.border}`}
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">{style.icon}</div>
                  <div className="flex-1 min-w-0">
                    {/* 标题行 */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">
                          {anomaly.description}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[12px] border ${style.badge}`}>
                          {t(`monitoring.anomaly.type.${anomaly.type}`, language) ===
                          `monitoring.anomaly.type.${anomaly.type}`
                            ? anomaly.type
                            : t(`monitoring.anomaly.type.${anomaly.type}`, language)}
                        </span>
                        <StatusBadge status={anomaly.status} language={language} />
                      </div>
                      <span className="text-[12px] text-text-muted shrink-0">
                        {formatRelativeTime(anomaly.timestamp, language)}
                      </span>
                    </div>

                    {/* 当前值 + 预测峰值 */}
                    <div className="flex items-center gap-4 mt-2 text-[12px] text-text-secondary">
                      <span>
                        {t('monitoring.anomaly.currentValue', language)}:
                        <span className="font-mono font-semibold text-text-primary ml-1">
                          {anomaly.currentValue.toFixed(1)}
                        </span>
                      </span>
                      {anomaly.predictedPeak !== undefined && (
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-amber-500" />
                          {t('monitoring.anomaly.predictedPeak', language)}:
                          <span className="font-mono font-semibold text-amber-500 ml-1">
                            {anomaly.predictedPeak.toFixed(1)}
                          </span>
                        </span>
                      )}
                      {anomaly.predictedTriggerAt !== undefined && (
                        <span className="text-amber-500">
                          {t('monitoring.anomaly.predictedTriggerAt', language)}:
                          <span className="ml-1 font-mono">
                            {new Date(anomaly.predictedTriggerAt).toLocaleString(
                              language === 'zh' ? 'zh-CN' : 'en-US',
                              { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' },
                            )}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* 建议 */}
                    <p className="text-[12px] text-text-muted mt-2 leading-relaxed">
                      {anomaly.recommendation}
                    </p>

                    {/* 操作按钮 */}
                    {anomaly.status === 'active' && (
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => void handleAcknowledge(anomaly.id)}
                          disabled={busyId === anomaly.id}
                          className="px-3 py-1 rounded-lg text-[12px] font-medium bg-surface/60 hover:bg-surface-hover text-text-primary border border-border/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('monitoring.anomaly.acknowledge', language)}
                        </button>
                        <button
                          onClick={() => void handleResolve(anomaly.id)}
                          disabled={busyId === anomaly.id}
                          className="px-3 py-1 rounded-lg text-[12px] font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-500 border border-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('monitoring.anomaly.resolve', language)}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
