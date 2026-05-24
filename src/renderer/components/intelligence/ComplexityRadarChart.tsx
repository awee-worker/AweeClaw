/**
 * 任务复杂度雷达图组件
 *
 * 使用 SVG 绘制五维复杂度雷达图，展示任务在以下维度的得分：
 * - 多步骤 (multiStep)
 * - 任务长度 (length)
 * - 领域交叉 (domainCrossing)
 * - 文件范围 (fileScope)
 * - 特殊关键词 (specialKeywords)
 */

import { useMemo } from 'react'
import type { ComplexityScore } from '@intelligence/capabilities/planning/TaskComplexityDetector'

interface ComplexityRadarChartProps {
  score: ComplexityScore
  size?: number
  language?: 'zh' | 'en'
}

const LABELS: Record<string, { zh: string; en: string }> = {
  multiStep: { zh: '多步骤', en: 'Multi-step' },
  length: { zh: '任务长度', en: 'Length' },
  domainCrossing: { zh: '领域交叉', en: 'Cross-domain' },
  fileScope: { zh: '文件范围', en: 'File Scope' },
  specialKeywords: { zh: '特殊关键词', en: 'Keywords' },
}

const COLORS = {
  grid: 'rgba(148, 163, 184, 0.15)',
  axis: 'rgba(148, 163, 184, 0.3)',
  area: 'rgba(99, 102, 241, 0.25)',
  stroke: 'rgba(99, 102, 241, 0.8)',
  point: '#6366f1',
  text: 'rgba(148, 163, 184, 0.8)',
  textHighlight: '#e2e8f0',
}

export function ComplexityRadarChart({ score, size = 160, language = 'zh' }: ComplexityRadarChartProps) {
  const dimensions = useMemo(() => [
    { key: 'multiStep', value: score.dimensions.multiStep },
    { key: 'length', value: score.dimensions.length },
    { key: 'domainCrossing', value: score.dimensions.domainCrossing },
    { key: 'fileScope', value: score.dimensions.fileScope },
    { key: 'specialKeywords', value: score.dimensions.specialKeywords },
  ], [score])

  const center = size / 2
  const radius = size * 0.32
  const angleStep = (Math.PI * 2) / 5
  const startAngle = -Math.PI / 2

  // 计算多边形顶点
  const points = dimensions.map((d, i) => {
    const angle = startAngle + i * angleStep
    const r = (d.value / 100) * radius
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      label: LABELS[d.key][language],
      value: d.value,
    }
  })

  // 网格层级
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0]

  // 标签位置（外圈）
  const labelPoints = dimensions.map((_, i) => {
    const angle = startAngle + i * angleStep
    const labelRadius = radius + 22
    return {
      x: center + labelRadius * Math.cos(angle),
      y: center + labelRadius * Math.sin(angle),
    }
  })

  const polygonPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'

  // 根据总分决定颜色主题
  const getScoreColor = () => {
    if (score.total >= 80) return '#ef4444'
    if (score.total >= 60) return '#f59e0b'
    if (score.total >= 40) return '#6366f1'
    return '#10b981'
  }

  const scoreColor = getScoreColor()

  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {/* 背景网格 */}
        {gridLevels.map((level) => {
          const levelRadius = radius * level
          const levelPoints = Array.from({ length: 5 }, (_, i) => {
            const angle = startAngle + i * angleStep
            return `${center + levelRadius * Math.cos(angle)},${center + levelRadius * Math.sin(angle)}`
          }).join(' ')

          return (
            <polygon
              key={level}
              points={levelPoints}
              fill="none"
              stroke={COLORS.grid}
              strokeWidth={0.5}
            />
          )
        })}

        {/* 轴线 */}
        {Array.from({ length: 5 }, (_, i) => {
          const angle = startAngle + i * angleStep
          const x2 = center + radius * Math.cos(angle)
          const y2 = center + radius * Math.sin(angle)
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x2}
              y2={y2}
              stroke={COLORS.axis}
              strokeWidth={0.5}
            />
          )
        })}

        {/* 数据区域 */}
        <path
          d={polygonPath}
          fill={scoreColor}
          fillOpacity={0.2}
          stroke={scoreColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* 数据点 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill={scoreColor} stroke="#1e293b" strokeWidth={1} />
            {/* 数值标签 */}
            <text
              x={p.x}
              y={p.y - 8}
              textAnchor="middle"
              fill={COLORS.textHighlight}
              fontSize={8}
              fontWeight={600}
            >
              {p.value}
            </text>
          </g>
        ))}

        {/* 维度标签 */}
        {labelPoints.map((lp, i) => (
          <text
            key={`label-${i}`}
            x={lp.x}
            y={lp.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={COLORS.text}
            fontSize={9}
          >
            {dimensions[i].value > 0 ? (
              <tspan fontWeight={600} fill={COLORS.textHighlight}>
                {LABELS[dimensions[i].key][language]}
              </tspan>
            ) : (
              LABELS[dimensions[i].key][language]
            )}
          </text>
        ))}
      </svg>

      {/* 总分显示 */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted">{language === 'zh' ? '复杂度' : 'Complexity'}</span>
        <span
          className="text-sm font-bold"
          style={{ color: scoreColor }}
        >
          {score.total}
        </span>
        <span className="text-[10px] text-text-muted">/100</span>
      </div>

      {/* 是否需要多 Agent */}
      {score.needsMultiAgent && (
        <div className="mt-1 px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/25 text-purple-400 text-[9px] font-medium">
          {language === 'zh' ? '建议多 Agent 协作' : 'Multi-Agent Recommended'}
        </div>
      )}
    </div>
  )
}
