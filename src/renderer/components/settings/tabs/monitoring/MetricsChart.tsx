/**
 * 系统指标折线图组件
 *
 * 使用 SVG 手绘折线图（避免引入重型图表库）。
 * 支持：
 * - 多指标切换显示
 * - 时间轴标签
 * - 当前值/最大值/最小值标记
 * - 警告/严重阈值参考线
 * - 悬浮提示
 *
 * 数据源：window.electronAPI.monitoring.getMetricsByTimeRange()
 */

import { memo, useMemo, useState } from 'react'
import type { Language } from '@renderer/i18n'
import { t } from '@renderer/i18n'

/** 单条指标采样（精简版） */
export interface MetricSample {
  timestamp: number
  value: number
}

interface MetricsChartProps {
  /** 图表标题 */
  title: string
  /** 指标采样数据（按时间升序） */
  samples: MetricSample[]
  /** 警告阈值（参考线） */
  warningThreshold?: number
  /** 严重阈值（参考线） */
  criticalThreshold?: number
  /** 单位（%, MB, KB/s, ℃ 等） */
  unit?: string
  /** Y 轴最大值（可选，默认自适应） */
  yMax?: number
  /** 颜色（hex 或 tailwind class） */
  color?: string
  /** 语言 */
  language: Language
}

/** 图表内边距 */
const CHART_PADDING = { top: 16, right: 16, bottom: 28, left: 44 }
/** 图表宽度 */
const CHART_WIDTH = 720
/** 图表高度 */
const CHART_HEIGHT = 200

/**
 * 系统指标折线图
 *
 * 使用 SVG path 绘制，零依赖。支持：
 * - 折线 + 渐变填充
 * - 阈值参考线（虚线）
 * - 鼠标悬浮显示数据点详情
 */
export const MetricsChart = memo(function MetricsChart({
  title,
  samples,
  warningThreshold,
  criticalThreshold,
  unit = '',
  yMax,
  color = '#8b5cf6',
  language,
}: MetricsChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // 计算图表数据
  const { pathD, areaD, points, yMaxValue, yTicks, xTicks } = useMemo(() => {
    if (samples.length === 0) {
      return { pathD: '', areaD: '', points: [], yMaxValue: 0, yTicks: [], xTicks: [] }
    }

    const values = samples.map((s) => s.value)
    const dataMax = Math.max(...values, warningThreshold ?? 0, criticalThreshold ?? 0)
    const yMaxValue = yMax ?? Math.ceil(dataMax * 1.15)

    const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
    const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

    // X 轴坐标：按时间均匀分布
    const timeStart = samples[0].timestamp
    const timeEnd = samples[samples.length - 1].timestamp
    const timeRange = Math.max(timeEnd - timeStart, 1)

    const points = samples.map((s, i) => {
      // 若只有一个点，放在中央
      const xRatio = samples.length === 1 ? 0.5 : i / (samples.length - 1)
      const x = CHART_PADDING.left + xRatio * innerWidth
      const y = CHART_PADDING.top + (1 - s.value / yMaxValue) * innerHeight
      return { x, y, sample: s }
    })

    // 折线 path
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

    // 渐变填充 area
    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${CHART_PADDING.top + innerHeight} L ${points[0].x.toFixed(2)} ${CHART_PADDING.top + innerHeight} Z`

    // Y 轴刻度（4 条）
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = (yMaxValue / 4) * i
      const y = CHART_PADDING.top + (1 - value / yMaxValue) * innerHeight
      return { value, y }
    })

    // X 轴刻度（5 个时间点）
    const xTicks = Array.from({ length: 5 }, (_, i) => {
      const time = timeStart + (timeRange / 4) * i
      const x = CHART_PADDING.left + (i / 4) * innerWidth
      return { time, x }
    })

    return { pathD, areaD, points, yMaxValue, yTicks, xTicks }
  }, [samples, warningThreshold, criticalThreshold, yMax])

  // 时间格式化
  const formatTime = (ts: number) => {
    const date = new Date(ts)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  // 统计
  const stats = useMemo(() => {
    if (samples.length === 0) return null
    const values = samples.map((s) => s.value)
    return {
      current: values[values.length - 1],
      max: Math.max(...values),
      min: Math.min(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    }
  }, [samples])

  // 悬浮处理
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * CHART_WIDTH
    // 找到最近的点
    let minDist = Infinity
    let nearestIdx = -1
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - mouseX)
      if (dist < minDist) {
        minDist = dist
        nearestIdx = i
      }
    })
    setHoverIdx(nearestIdx >= 0 ? nearestIdx : null)
  }

  if (samples.length === 0) {
    return (
      <div className="p-4 bg-surface/20 rounded-xl border border-border/30">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-3">
          {title}
        </h4>
        <div className="flex items-center justify-center h-[120px] text-text-muted text-sm">
          {t('monitoring.chart.noData', language)}
        </div>
      </div>
    )
  }

  const warningY = warningThreshold !== undefined
    ? CHART_PADDING.top + (1 - warningThreshold / yMaxValue) * (CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom)
    : null
  const criticalY = criticalThreshold !== undefined
    ? CHART_PADDING.top + (1 - criticalThreshold / yMaxValue) * (CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom)
    : null

  return (
    <div className="p-4 bg-surface/20 rounded-xl border border-border/30">
      {/* 标题 + 统计 */}
      <div className="flex items-start justify-between mb-3">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
          {title}
        </h4>
        {stats && (
          <div className="flex items-center gap-3 text-[12px] text-text-secondary">
            <span>
              {t('monitoring.chart.current', language)}:
              <span className="ml-1 font-mono font-semibold" style={{ color }}>
                {stats.current.toFixed(1)}{unit}
              </span>
            </span>
            <span className="text-text-muted">
              {t('monitoring.chart.max', language)}: {stats.max.toFixed(1)}{unit}
            </span>
            <span className="text-text-muted">
              {t('monitoring.chart.min', language)}: {stats.min.toFixed(1)}{unit}
            </span>
            <span className="text-text-muted">
              {t('monitoring.chart.avg', language)}: {stats.avg.toFixed(1)}{unit}
            </span>
          </div>
        )}
      </div>

      {/* SVG 折线图 */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full"
          style={{ height: CHART_HEIGHT }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`grad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Y 轴网格线 + 刻度 */}
          {yTicks.map((tick, i) => (
            <g key={`y-${i}`}>
              <line
                x1={CHART_PADDING.left}
                y1={tick.y}
                x2={CHART_WIDTH - CHART_PADDING.right}
                y2={tick.y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={CHART_PADDING.left - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="fill-text-muted"
                fontSize={10}
              >
                {tick.value.toFixed(0)}
              </text>
            </g>
          ))}

          {/* X 轴刻度 */}
          {xTicks.map((tick, i) => (
            <text
              key={`x-${i}`}
              x={tick.x}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              className="fill-text-muted"
              fontSize={10}
            >
              {formatTime(tick.time)}
            </text>
          ))}

          {/* 警告阈值参考线 */}
          {warningY !== null && (
            <g>
              <line
                x1={CHART_PADDING.left}
                y1={warningY}
                x2={CHART_WIDTH - CHART_PADDING.right}
                y2={warningY}
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.6}
              />
              <text
                x={CHART_WIDTH - CHART_PADDING.right - 4}
                y={warningY - 4}
                textAnchor="end"
                fill="#f59e0b"
                fontSize={10}
              >
                {t('monitoring.chart.warning', language)} {warningThreshold}{unit}
              </text>
            </g>
          )}

          {/* 严重阈值参考线 */}
          {criticalY !== null && (
            <g>
              <line
                x1={CHART_PADDING.left}
                y1={criticalY}
                x2={CHART_WIDTH - CHART_PADDING.right}
                y2={criticalY}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.6}
              />
              <text
                x={CHART_WIDTH - CHART_PADDING.right - 4}
                y={criticalY - 4}
                textAnchor="end"
                fill="#ef4444"
                fontSize={10}
              >
                {t('monitoring.chart.critical', language)} {criticalThreshold}{unit}
              </text>
            </g>
          )}

          {/* 渐变填充 */}
          <path d={areaD} fill={`url(#grad-${title.replace(/\s/g, '')})`} />

          {/* 折线 */}
          <path d={pathD} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />

          {/* 数据点 */}
          {points.map((p, i) => (
            <circle
              key={`pt-${i}`}
              cx={p.x}
              cy={p.y}
              r={hoverIdx === i ? 4 : 2}
              fill={color}
              stroke="white"
              strokeWidth={1}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5}
            />
          ))}

          {/* 悬浮提示线 */}
          {hoverIdx !== null && points[hoverIdx] && (
            <line
              x1={points[hoverIdx].x}
              y1={CHART_PADDING.top}
              x2={points[hoverIdx].x}
              y2={CHART_HEIGHT - CHART_PADDING.bottom}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="3 2"
              opacity={0.4}
            />
          )}
        </svg>

        {/* 悬浮提示框 */}
        {hoverIdx !== null && points[hoverIdx] && (
          <div
            className="absolute pointer-events-none px-2.5 py-1.5 rounded-md bg-surface border border-border/60 shadow-md text-[12px]"
            style={{
              left: `${(points[hoverIdx].x / CHART_WIDTH) * 100}%`,
              top: 4,
              transform: 'translateX(-50%)',
              maxWidth: '180px',
            }}
          >
            <div className="text-text-muted">
              {formatTime(points[hoverIdx].sample.timestamp)}
            </div>
            <div className="font-mono font-semibold" style={{ color }}>
              {points[hoverIdx].sample.value.toFixed(2)}{unit}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
