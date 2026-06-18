/**
 * 图表渲染组件
 * 根据 chart_generate 工具返回的配置，使用 Canvas 渲染图表
 * 支持柱状图、折线图、饼图、散点图、面积图、雷达图
 */
import { memo, useRef, useEffect, useState, useCallback } from 'react'
import {
  BarChart3,
  TrendingUp,
  PieChart,
  ScatterChart,
  Activity,
  Radar,
  Download,
  ZoomIn,
  ZoomOut,
  Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'radar'
  title?: string
  labels?: string[]
  series?: {
    name?: string
    type?: string
    data: number[]
    color?: string
  }[]
  colors?: string[]
  width?: number
  height?: number
  options?: Record<string, unknown>
}

interface ChartRendererProps {
  config: ChartConfig
  className?: string
  onDownload?: () => void
}

const DEFAULT_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
]

const CHART_ICONS: Record<string, typeof BarChart3> = {
  bar: BarChart3,
  line: TrendingUp,
  pie: PieChart,
  scatter: ScatterChart,
  area: Activity,
  radar: Radar,
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: ChartConfig,
  colors: string[],
) {
  const { labels = [], series = [] } = config
  const pad = { top: 40, right: 20, bottom: 60, left: 60 }
  const cw = w - pad.left - pad.right
  const ch = h - pad.top - pad.bottom

  const allValues = series.flatMap((s) => s.data)
  const maxVal = Math.max(...allValues, 1)
  const minVal = Math.min(0, ...allValues)

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(w - pad.right, y)
    ctx.stroke()

    const val = maxVal - ((maxVal - minVal) / 5) * i
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(Math.round(val).toString(), pad.left - 8, y + 4)
  }

  // Bars
  const groupWidth = cw / labels.length
  const barWidth = (groupWidth * 0.7) / series.length
  const gap = barWidth * 0.2

  series.forEach((s, si) => {
    ctx.fillStyle = s.color || colors[si % colors.length]
    s.data.forEach((val, i) => {
      const x = pad.left + groupWidth * i + groupWidth * 0.15 + (barWidth + gap) * si
      const barH = ((val - minVal) / (maxVal - minVal)) * ch
      const y = pad.top + ch - barH
      ctx.fillRect(x, y, barWidth, barH)
    })
  })

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  labels.forEach((label, i) => {
    const x = pad.left + groupWidth * i + groupWidth / 2
    ctx.fillText(label.length > 8 ? label.slice(0, 8) + '...' : label, x, h - pad.bottom + 20)
  })

  // Title
  if (config.title) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(config.title, w / 2, 24)
  }

  // Legend
  series.forEach((s, i) => {
    const lx = pad.left + 120 * i
    const ly = h - 12
    ctx.fillStyle = s.color || colors[i % colors.length]
    ctx.fillRect(lx, ly - 6, 12, 12)
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(s.name || `系列${i + 1}`, lx + 16, ly + 4)
  })
}

function drawPieChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: ChartConfig,
  colors: string[],
) {
  const { labels = [], series = [] } = config
  const data = series[0]?.data || []
  const total = data.reduce((a, b) => a + b, 0)
  if (total === 0) return

  const cx = w / 2
  const cy = h / 2 + 10
  const radius = Math.min(w, h) / 2 - 60

  let startAngle = -Math.PI / 2
  data.forEach((val, i) => {
    const sliceAngle = (val / total) * Math.PI * 2
    ctx.beginPath()
    ctx.fillStyle = colors[i % colors.length]
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle)
    ctx.closePath()
    ctx.fill()

    // Label
    const midAngle = startAngle + sliceAngle / 2
    const lx = cx + Math.cos(midAngle) * (radius + 30)
    const ly = cy + Math.sin(midAngle) * (radius + 30)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    const pct = ((val / total) * 100).toFixed(0)
    ctx.fillText(`${labels[i] || ''} ${pct}%`, lx, ly)

    startAngle += sliceAngle
  })

  // Title
  if (config.title) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(config.title, w / 2, 24)
  }
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: ChartConfig,
  colors: string[],
) {
  const { labels = [], series = [] } = config
  const pad = { top: 40, right: 20, bottom: 60, left: 60 }
  const cw = w - pad.left - pad.right
  const ch = h - pad.top - pad.bottom

  const allValues = series.flatMap((s) => s.data)
  const maxVal = Math.max(...allValues, 1)
  const minVal = Math.min(0, ...allValues)
  const range = maxVal - minVal || 1

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(w - pad.right, y)
    ctx.stroke()
  }

  // Lines
  series.forEach((s, si) => {
    const color = s.color || colors[si % colors.length]
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()

    s.data.forEach((val, i) => {
      const x = pad.left + (cw / (s.data.length - 1 || 1)) * i
      const y = pad.top + ch - ((val - minVal) / range) * ch
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Dots
    ctx.fillStyle = color
    s.data.forEach((val, i) => {
      const x = pad.left + (cw / (s.data.length - 1 || 1)) * i
      const y = pad.top + ch - ((val - minVal) / range) * ch
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    })
  })

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  labels.forEach((label, i) => {
    const x = pad.left + (cw / (labels.length - 1 || 1)) * i
    ctx.fillText(label, x, h - pad.bottom + 20)
  })

  if (config.title) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(config.title, w / 2, 24)
  }
}

function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, config: ChartConfig) {
  const colors = config.colors || DEFAULT_COLORS

  ctx.clearRect(0, 0, w, h)

  switch (config.type) {
    case 'pie':
      drawPieChart(ctx, w, h, config, colors)
      break
    case 'line':
      drawLineChart(ctx, w, h, config, colors)
      break
    case 'bar':
    case 'area':
    default:
      drawBarChart(ctx, w, h, config, colors)
      break
  }
}

export const ChartRenderer = memo(function ChartRenderer({
  config,
  className = '',
  onDownload,
}: ChartRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)

  const Icon = CHART_ICONS[config.type] || BarChart3

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = (config.width || 600) * scale
    const h = (config.height || 360) * scale

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    drawChart(ctx, w, h, config)
    setLoading(false)
  }, [config, scale])

  useEffect(() => {
    setLoading(true)
    const timer = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(timer)
  }, [draw])

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `chart-${config.title || 'export'}-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    onDownload?.()
  }, [config.title, onDownload])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border border-border bg-bg-elevated overflow-hidden ${className}`}
    >
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-medium text-text-primary">
            {config.title || '图表'}
          </span>
          <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-base">
            {config.type}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-text-muted w-8 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2, s + 0.25))}
            className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDownload}
            className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
            title="下载图片"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 图表区 */}
      <div ref={containerRef} className="relative flex items-center justify-center p-4 overflow-auto">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated/50">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          </div>
        )}
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
    </motion.div>
  )
})