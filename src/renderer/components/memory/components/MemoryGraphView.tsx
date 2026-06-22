/**
 * 记忆关联图谱视图
 * 2D Canvas 实现的力导向图，展示记忆间的关联关系
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { Share2, ZoomIn, ZoomOut, Maximize, RefreshCw } from 'lucide-react'
import { useMemoryStore } from '../store'
import { CATEGORY_META } from '../types'

interface GraphNode {
  id: string
  label: string
  category: string
  importance: number
  x: number
  y: number
  vx: number
  vy: number
  connections: number
}

interface GraphEdge {
  source: string
  target: string
  weight: number
}

export function MemoryGraphView() {
  const { visualizationData, fetchVisualizationData } = useMemoryStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number>()
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragNodeRef = useRef<string | null>(null)
  const lastMouseRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    fetchVisualizationData()
  }, [fetchVisualizationData])

  // 构建图节点和边
  const { nodes, edges } = useMemo(() => {
    if (!visualizationData) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] }

    const visNodes = visualizationData.nodes.slice(0, 100)
    const visEdges = visualizationData.edges.slice(0, 150)

    // 计算每个节点的连接数
    const connectionCount = new Map<string, number>()
    visEdges.forEach((e) => {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1)
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1)
    })

    // 初始化节点位置（圆形分布）
    const graphNodes: GraphNode[] = visNodes.map((node, i) => {
      const angle = (i / visNodes.length) * Math.PI * 2
      const r = 200
      return {
        id: node.id,
        label: node.label,
        category: node.category,
        importance: node.importance,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        connections: connectionCount.get(node.id) ?? 0,
      }
    })

    const graphEdges: GraphEdge[] = visEdges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }))

    return { nodes: graphNodes, edges: graphEdges }
  }, [visualizationData])

  // 力导向布局
  useEffect(() => {
    if (nodes.length === 0) return

    const simulate = () => {
      const REPULSION = 8000
      const ATTRACTION = 0.005
      const DAMPING = 0.85
      const CENTER_FORCE = 0.001

      // 节点间斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x
          const dy = nodes[j].y - nodes[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = REPULSION / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          nodes[i].vx -= fx
          nodes[i].vy -= fy
          nodes[j].vx += fx
          nodes[j].vy += fy
        }
      }

      // 边的引力
      edges.forEach((edge) => {
        const source = nodes.find((n) => n.id === edge.source)
        const target = nodes.find((n) => n.id === edge.target)
        if (!source || !target) return

        const dx = target.x - source.x
        const dy = target.y - source.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = ATTRACTION * dist * edge.weight
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        source.vx += fx
        source.vy += fy
        target.vx -= fx
        target.vy -= fy
      })

      // 向中心吸引
      nodes.forEach((node) => {
        node.vx -= node.x * CENTER_FORCE
        node.vy -= node.y * CENTER_FORCE
      })

      // 更新位置
      nodes.forEach((node) => {
        if (dragNodeRef.current === node.id) return
        node.vx *= DAMPING
        node.vy *= DAMPING
        node.x += node.vx
        node.y += node.vy
      })
    }

    const render = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const width = container.clientWidth
      const height = container.clientHeight
      canvas.width = width * window.devicePixelRatio
      canvas.height = height * window.devicePixelRatio
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

      // 清空：径向渐变背景（深空感）
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 1.2,
      )
      bgGrad.addColorStop(0.0, 'rgba(30, 41, 59, 0.95)')
      bgGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.95)')
      bgGrad.addColorStop(1.0, 'rgba(2, 6, 23, 1.0)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, width, height)

      // 装饰星点（静态背景）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      for (let i = 0; i < 60; i++) {
        const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1
        const sy = (Math.sin(i * 78.233) * 43758.5453) % 1
        const px = (Math.abs(sx) * width) | 0
        const py = (Math.abs(sy) * height) | 0
        const sr = (Math.abs(Math.sin(i * 3.7)) * 1.2) + 0.3
        ctx.beginPath()
        ctx.arc(px, py, sr, 0, Math.PI * 2)
        ctx.fill()
      }

      // 应用变换
      ctx.save()
      ctx.translate(width / 2 + offset.x, height / 2 + offset.y)
      ctx.scale(zoom, zoom)

      // 绘制边（带渐变）
      edges.forEach((edge) => {
        const source = nodes.find((n) => n.id === edge.source)
        const target = nodes.find((n) => n.id === edge.target)
        if (!source || !target) return

        const isHighlighted =
          hoveredNode === source.id ||
          hoveredNode === target.id ||
          selectedNode === source.id ||
          selectedNode === target.id

        const srcMeta = CATEGORY_META[source.category as keyof typeof CATEGORY_META] ?? CATEGORY_META.UNCATEGORIZED
        const tgtMeta = CATEGORY_META[target.category as keyof typeof CATEGORY_META] ?? CATEGORY_META.UNCATEGORIZED

        const grad = ctx.createLinearGradient(source.x, source.y, target.x, target.y)
        if (isHighlighted) {
          grad.addColorStop(0, `${srcMeta.color}cc`)
          grad.addColorStop(1, `${tgtMeta.color}cc`)
        } else {
          grad.addColorStop(0, `${srcMeta.color}40`)
          grad.addColorStop(1, `${tgtMeta.color}40`)
        }

        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)
        ctx.strokeStyle = grad
        ctx.lineWidth = isHighlighted ? 2 : 0.8
        ctx.stroke()
      })

      // 绘制节点（带发光效果）
      nodes.forEach((node) => {
        const meta = CATEGORY_META[node.category as keyof typeof CATEGORY_META] ?? CATEGORY_META.UNCATEGORIZED
        const isHovered = hoveredNode === node.id
        const isSelected = selectedNode === node.id
        const isConnected =
          hoveredNode &&
          edges.some(
            (e) =>
              (e.source === hoveredNode && e.target === node.id) ||
              (e.target === hoveredNode && e.source === node.id),
          )

        const radius = 4 + Math.sqrt(node.connections) * 2 + node.importance * 3
        const opacity = !hoveredNode || isHovered || isConnected ? 1 : 0.35

        // 外层光晕（径向渐变）
        const glowRadius = radius * (isHovered || isSelected ? 4 : 2.5)
        const glow = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius,
        )
        glow.addColorStop(0, `${meta.color}${isHovered || isSelected ? 'aa' : '55'}`)
        glow.addColorStop(0.5, `${meta.color}20`)
        glow.addColorStop(1, `${meta.color}00`)
        ctx.beginPath()
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.globalAlpha = opacity
        ctx.fill()

        // 主节点
        ctx.beginPath()
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = meta.color
        ctx.globalAlpha = opacity
        ctx.fill()

        // 内部高光（球体感）
        ctx.beginPath()
        ctx.arc(node.x - radius * 0.3, node.y - radius * 0.3, radius * 0.4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.fill()
        ctx.globalAlpha = 1

        // 选中边框
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2)
          ctx.strokeStyle = '#FFFFFF'
          ctx.lineWidth = 2
          ctx.stroke()
        }

        // 标签（仅悬停或选中时）
        if (isHovered || isSelected) {
          ctx.font = '12px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const label = node.label.length > 20 ? node.label.slice(0, 20) + '...' : node.label
          const metrics = ctx.measureText(label)
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'
          ctx.fillRect(
            node.x - metrics.width / 2 - 6,
            node.y - radius - 24,
            metrics.width + 12,
            20,
          )
          ctx.strokeStyle = `${meta.color}80`
          ctx.lineWidth = 1
          ctx.strokeRect(
            node.x - metrics.width / 2 - 6,
            node.y - radius - 24,
            metrics.width + 12,
            20,
          )
          ctx.fillStyle = '#FFFFFF'
          ctx.fillText(label, node.x, node.y - radius - 14)
        }
      })

      ctx.restore()

      // 模拟下一步
      simulate()
      animationRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [nodes, edges, hoveredNode, selectedNode, zoom, offset])

  // 鼠标交互
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left - rect.width / 2 - offset.x
    const my = e.clientY - rect.top - rect.height / 2 - offset.y
    const worldX = mx / zoom
    const worldY = my / zoom

    if (isDraggingRef.current && dragNodeRef.current) {
      const node = nodes.find((n) => n.id === dragNodeRef.current)
      if (node) {
        node.x = worldX
        node.y = worldY
        node.vx = 0
        node.vy = 0
      }
    } else if (isDraggingRef.current) {
      // 平移
      const dx = e.clientX - lastMouseRef.current.x
      const dy = e.clientY - lastMouseRef.current.y
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
    } else {
      // 悬停检测
      let found: string | null = null
      for (const node of nodes) {
        const dx = worldX - node.x
        const dy = worldY - node.y
        const r = 4 + Math.sqrt(node.connections) * 2 + node.importance * 3
        if (dx * dx + dy * dy < r * r * 4) {
          found = node.id
          break
        }
      }
      setHoveredNode(found)
      canvas.style.cursor = found ? 'pointer' : 'default'
    }

    lastMouseRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
    if (hoveredNode) {
      dragNodeRef.current = hoveredNode
    }
  }

  const handleMouseUp = () => {
    if (hoveredNode && !dragNodeRef.current) {
      setSelectedNode(selectedNode === hoveredNode ? null : hoveredNode)
    }
    isDraggingRef.current = false
    dragNodeRef.current = null
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)))
  }

  return (
    <div className="relative w-full h-full bg-slate-950">
      {/* 顶部控制栏 */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          className="p-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-text-secondary hover:text-text-primary transition-colors"
          title="放大"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
          className="p-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-text-secondary hover:text-text-primary transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => {
            setZoom(1)
            setOffset({ x: 0, y: 0 })
          }}
          className="p-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-text-secondary hover:text-text-primary transition-colors"
          title="重置视图"
        >
          <Maximize className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fetchVisualizationData()}
          className="p-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-text-secondary hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 图例 */}
      <div className="absolute top-3 left-3 z-10 px-3 py-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40">
        <div className="text-[10px] text-text-muted mb-1.5 flex items-center gap-1">
          <Share2 className="w-3 h-3" />
          记忆图谱
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(CATEGORY_META)
            .filter(([key]) => key !== 'UNCATEGORIZED')
            .slice(0, 8)
            .map(([key, meta]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-[10px] text-text-secondary">{meta.label}</span>
              </div>
            ))}
        </div>
      </div>

      {/* 统计信息 */}
      {visualizationData && (
        <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-xs">
          <div className="flex items-center gap-3 text-text-muted">
            <span>节点: <span className="text-text-primary font-mono">{nodes.length}</span></span>
            <span>关联: <span className="text-text-primary font-mono">{edges.length}</span></span>
            <span>缩放: <span className="text-accent font-mono">{zoom.toFixed(1)}x</span></span>
          </div>
        </div>
      )}

      {/* 操作提示 */}
      <div className="absolute bottom-3 right-3 z-10 px-3 py-1.5 rounded-lg bg-surface/80 backdrop-blur border border-border/40 text-[10px] text-text-muted">
        拖拽节点 · 滚轮缩放 · 点击选中
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="w-full h-full">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            isDraggingRef.current = false
            dragNodeRef.current = null
            setHoveredNode(null)
          }}
          onWheel={handleWheel}
        />
      </div>
    </div>
  )
}
