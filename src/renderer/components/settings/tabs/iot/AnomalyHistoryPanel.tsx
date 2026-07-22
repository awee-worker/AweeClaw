/**
 * 异常事件历史日志面板（阶段7 s7-07 新增）
 *
 * 功能：
 * - 从本地 SQLite 查询历史异常事件（通过 sensorFusion.queryAnomalies IPC）
 * - 支持多维度过滤：异常类型、严重度、实体类型
 * - 分页浏览（每页 20 条，支持上一页/下一页）
 * - 表格展示关键字段（时间/实体/类型/严重度/当前值/描述）
 * - 点击行展开查看完整描述和建议
 *
 * 数据流：
 * - 查询：window.electronAPI.sensorFusion.queryAnomalies(filter)
 * - 数据来源：本地 SQLite（iot_anomaly_events.db）
 *
 * @module settings/tabs/iot/AnomalyHistoryPanel
 */

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface AnomalyHistoryPanelProps {
  language: Language
  /** 刷新触发器（父组件刷新时传入新值） */
  refreshKey: number
}

/** 异常事件（与 electronBridge.d.ts 一致） */
interface SensorAnomalyEvent {
  id: string
  timestamp: number
  type: 'zscore_outlier' | 'rate_of_change' | 'stuck_value' | 'out_of_range'
  severity: 'info' | 'warning' | 'critical'
  providerId: string
  entityId: string
  externalId: string
  entityType: string
  currentValue: number
  unit?: string
  windowStats: {
    externalId: string
    count: number
    mean: number
    std: number
    min: number
    max: number
    lastTimestamp: number
    lastValue: number | null
  }
  description: string
  recommendation: string
  zscore?: number
  rateOfChange?: number
  stuckDurationMs?: number
}

/** 查询过滤条件 */
interface QueryFilter {
  type?: string
  severity?: string
  entityType?: string
  limit: number
  offset: number
  sort: 'asc' | 'desc'
}

/** 查询结果 */
interface QueryResult {
  items: SensorAnomalyEvent[]
  total: number
}

/** 每页条数 */
const PAGE_SIZE = 20

/** 异常类型选项 */
const TYPE_OPTIONS = [
  { value: '', labelKey: 'iot.fusion.filterAll' },
  { value: 'zscore_outlier', labelKey: 'iot.anomalyType.zscore_outlier' },
  { value: 'rate_of_change', labelKey: 'iot.anomalyType.rate_of_change' },
  { value: 'stuck_value', labelKey: 'iot.anomalyType.stuck_value' },
  { value: 'out_of_range', labelKey: 'iot.anomalyType.out_of_range' },
]

/** 严重度选项 */
const SEVERITY_OPTIONS = [
  { value: '', labelKey: 'iot.fusion.filterAll' },
  { value: 'info', labelKey: 'iot.fusion.severityInfo' },
  { value: 'warning', labelKey: 'iot.fusion.severityWarning' },
  { value: 'critical', labelKey: 'iot.fusion.severityCritical' },
]

/** 实体类型选项 */
const ENTITY_TYPE_OPTIONS = [
  { value: '', labelKey: 'iot.fusion.filterAll' },
  { value: 'sensor', labelKey: 'sensor' },
  { value: 'binary_sensor', labelKey: 'binary_sensor' },
  { value: 'switch', labelKey: 'switch' },
  { value: 'light', labelKey: 'light' },
  { value: 'climate', labelKey: 'climate' },
  { value: 'cover', labelKey: 'cover' },
  { value: 'lock', labelKey: 'lock' },
  { value: 'media_player', labelKey: 'media_player' },
  { value: 'device_tracker', labelKey: 'device_tracker' },
  { value: 'unknown', labelKey: 'unknown' },
]

/**
 * AnomalyHistoryPanel
 */
export function AnomalyHistoryPanel({
  language,
  refreshKey,
}: AnomalyHistoryPanelProps) {
  const t = createTranslator(language)
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'

  const [filterType, setFilterType] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterEntityType, setFilterEntityType] = useState('')

  const [items, setItems] = useState<SensorAnomalyEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /** 查询历史异常事件 */
  const queryHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filter: QueryFilter = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort: 'desc',
      }
      if (filterType) filter.type = filterType
      if (filterSeverity) filter.severity = filterSeverity
      if (filterEntityType) filter.entityType = filterEntityType

      const result = await window.electronAPI.sensorFusion.queryAnomalies(
        filter,
      )
      if (result.success && result.data) {
        const data = result.data as QueryResult
        setItems(data.items)
        setTotal(data.total)
      } else {
        setError(result.error ?? t('iot.fusion.historyError'))
        setItems([])
        setTotal(0)
      }
    } catch (e) {
      logger.settings?.error('Failed to query anomaly history:', e)
      setError(e instanceof Error ? e.message : String(e))
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterSeverity, filterEntityType, page, t])

  /** 初始加载 + 过滤条件变化时重新查询（重置到第 1 页） */
  useEffect(() => {
    setPage(1)
    void queryHistory()
  }, [filterType, filterSeverity, filterEntityType, queryHistory, refreshKey])

  /** 页码变化时重新查询 */
  useEffect(() => {
    void queryHistory()
  }, [page, queryHistory])

  /** 重置过滤条件 */
  const handleReset = useCallback(() => {
    setFilterType('')
    setFilterSeverity('')
    setFilterEntityType('')
    setPage(1)
  }, [])

  /** 格式化时间戳 */
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString(locale, {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /** 获取严重度样式 */
  const getSeverityStyle = (severity: SensorAnomalyEvent['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/10 text-red-500 border-red-500/20'
      case 'warning':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
      case 'info':
      default:
        return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20'
    }
  }

  /** 总页数 */
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /** 渲染翻译文本（支持 {current}/{total}/{count} 占位符） */
  const renderPageInfo = () => {
    const template = t('iot.fusion.pageInfo')
    return template
      .replace('{current}', String(page))
      .replace('{total}', String(totalPages))
      .replace('{count}', String(total))
  }

  return (
    <section className="space-y-3 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-text-muted" />
          <div>
            <h4 className="text-sm font-bold text-text-primary">
              {t('iot.fusion.historyTitle')}
            </h4>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('iot.fusion.historySubtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={() => void queryHistory()}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-surface/40 disabled:opacity-50"
          title={t('iot.fusion.filterButton')}
        >
          <RefreshCw
            className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* 过滤器 */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-surface/20 border border-border/30">
        <div className="flex items-center gap-2 text-text-muted">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[12px] uppercase tracking-wider">
            {t('iot.fusion.filterButton')}
          </span>
        </div>

        <FilterSelect
          label={t('iot.fusion.filterType')}
          value={filterType}
          options={TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.value === '' ? t(o.labelKey) : t(o.labelKey),
          }))}
          onChange={setFilterType}
        />

        <FilterSelect
          label={t('iot.fusion.filterSeverity')}
          value={filterSeverity}
          options={SEVERITY_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
          onChange={setFilterSeverity}
        />

        <FilterSelect
          label={t('iot.fusion.filterEntityType')}
          value={filterEntityType}
          options={ENTITY_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.value === '' ? t(o.labelKey) : o.labelKey,
          }))}
          onChange={setFilterEntityType}
        />

        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-[12px] rounded-lg bg-surface/40 border border-border/40 hover:bg-surface/60 text-text-secondary"
        >
          {t('iot.fusion.resetButton')}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-500">
          {t('iot.fusion.historyError')}: {error}
        </div>
      )}

      {/* 加载中 */}
      {loading && items.length === 0 && (
        <div className="py-8 flex items-center justify-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('iot.fusion.loadingHistory')}
        </div>
      )}

      {/* 空数据 */}
      {!loading && items.length === 0 && !error && (
        <div className="py-8 text-center text-[12px] text-text-muted">
          {t('iot.fusion.noHistory')}
        </div>
      )}

      {/* 数据表格 */}
      {items.length > 0 && (
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-surface/40 text-text-muted">
                <tr>
                  <Th>{t('iot.fusion.columnTime')}</Th>
                  <Th>{t('iot.fusion.columnEntity')}</Th>
                  <Th>{t('iot.fusion.columnType')}</Th>
                  <Th>{t('iot.fusion.columnSeverity')}</Th>
                  <Th>{t('iot.fusion.columnValue')}</Th>
                  <Th>{t('iot.fusion.columnDescription')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isExpanded = expandedId === item.id
                  return (
                    <>
                      <tr
                        key={item.id}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : item.id)
                        }
                        className="border-t border-border/30 cursor-pointer hover:bg-surface/20 transition-colors"
                      >
                        <Td className="whitespace-nowrap text-text-muted">
                          {formatTime(item.timestamp)}
                        </Td>
                        <Td className="font-medium text-text-primary">
                          {item.externalId}
                          <div className="text-[12px] text-text-muted">
                            {item.entityType}
                          </div>
                        </Td>
                        <Td>
                          <span className="px-2 py-0.5 rounded-md bg-surface/40 text-text-secondary border border-border/30">
                            {t(`iot.anomalyType.${item.type}`)}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className={`px-2 py-0.5 rounded-md border ${getSeverityStyle(
                              item.severity,
                            )}`}
                          >
                            {t(`iot.fusion.severity${item.severity.charAt(0).toUpperCase()}${item.severity.slice(1)}`)}
                          </span>
                        </Td>
                        <Td className="text-text-primary whitespace-nowrap">
                          {item.currentValue}
                          {item.unit ? ` ${item.unit}` : ''}
                        </Td>
                        <Td className="text-text-secondary max-w-[300px] truncate">
                          {item.description}
                        </Td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-surface/20">
                          <td colSpan={6} className="p-3">
                            <div className="space-y-2">
                              <div>
                                <span className="text-text-muted">
                                  {t('iot.fusion.columnDescription')}:
                                </span>{' '}
                                <span className="text-text-primary">
                                  {item.description}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-muted">
                                  {t('iot.fusion.tip')}:
                                </span>{' '}
                                <span className="text-text-secondary italic">
                                  {item.recommendation}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-4 text-[12px] text-text-muted">
                                <span>
                                  ID: <code>{item.id}</code>
                                </span>
                                <span>
                                  {t('iot.fusion.columnEntity')}:{' '}
                                  {item.externalId}
                                </span>
                                {item.zscore !== undefined && (
                                  <span>Z-Score: {item.zscore.toFixed(2)}</span>
                                )}
                                {item.rateOfChange !== undefined && (
                                  <span>
                                    {t('iot.anomalyType.rate_of_change')}:{' '}
                                    {item.rateOfChange.toFixed(3)}/s
                                  </span>
                                )}
                                {item.stuckDurationMs !== undefined && (
                                  <span>
                                    {t('iot.anomalyType.stuck_value')}:{' '}
                                    {(item.stuckDurationMs / 1000).toFixed(0)}s
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="text-[12px] text-text-muted">{renderPageInfo()}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border border-border/40 hover:bg-surface/40 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('iot.fusion.pagePrev')}
            >
              <ChevronLeft className="w-4 h-4 text-text-secondary" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border border-border/40 hover:bg-surface/40 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('iot.fusion.pageNext')}
            >
              <ChevronRight className="w-4 h-4 text-text-secondary" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ============================================================
// 通用子组件
// ============================================================

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="block text-[12px] text-text-muted mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50 min-w-[100px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
