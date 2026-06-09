import { useState, useRef, useEffect, useCallback } from 'react'
import { ZoomIn, ZoomOut, X, RotateCcw, Loader2, AlertCircle, RefreshCw, Database, Cloud } from 'lucide-react'
import { localGraphStore } from '@intelligence/runtime/knowledgeService/localGraphStore'
import { backendApi, isAuthenticated } from '@services/backendApi'
import { type Language } from '@renderer/i18n'

const ENTITY_COLORS: Record<string, string> = {
  file: '#3b82f6',
  module: '#8b5cf6',
  function: '#10b981',
  class: '#f59e0b',
  interface: '#06b6d4',
  component: '#ec4899',
  api_endpoint: '#ef4444',
  database_table: '#f97316',
  config: '#6b7280',
  dependency: '#14b8a6',
  concept: '#a855f7',
}

interface ServerGraphEntity {
  id: string
  name: string
  type: string
  properties: Record<string, unknown> | null
  entryId: string | null
}

interface ServerGraphRelation {
  id: string
  sourceId: string
  targetId: string
  type: string
  properties: Record<string, unknown> | null
}

interface LocalEntity {
  id: string
  name: string
  type: string
  properties: Record<string, unknown>
}

interface LocalRelation {
  id: string
  sourceId: string
  targetId: string
  type: string
}

interface GraphNode {
  id: string
  name: string
  type: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

interface GraphEdge {
  source: string
  target: string
  type: string
}

interface KnowledgeGraphViewProps {
  language: Language
  onClose: () => void
  onSelectEntity?: (entity: LocalEntity) => void
}

type LoadState = 'idle' | 'loading' | 'success' | 'error'

export function KnowledgeGraphView({
  language,
  onClose,
  onSelectEntity,
}: KnowledgeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragNode, setDragNode] = useState<string | null>(null)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])
  const animFrameRef = useRef<number>(0)

  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [entities, setEntities] = useState<LocalEntity[]>([])
  const [relations, setRelations] = useState<LocalRelation[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [dataSource, setDataSource] = useState<'local' | 'server' | 'mixed'>('local')

  const isZh = language === 'zh'

  const fetchGraphData = useCallback(async () => {
    setLoadState('loading')
    setErrorMsg('')

    try {
      const localEntities = await localGraphStore.getEntities()
      const localRelations = await localGraphStore.getRelations()

      if (localEntities.length > 0) {
        const mappedEntities: LocalEntity[] = localEntities.map(e => ({
          id: e.id,
          name: e.name,
          type: e.type,
          properties: e.properties ?? {},
        }))

        const validEntityIds = new Set(mappedEntities.map(e => e.id))
        const mappedRelations: LocalRelation[] = localRelations
          .filter(r => validEntityIds.has(r.sourceId) && validEntityIds.has(r.targetId))
          .map(r => ({
            id: r.id,
            sourceId: r.sourceId,
            targetId: r.targetId,
            type: r.type,
          }))

        setEntities(mappedEntities)
        setRelations(mappedRelations)
        setDataSource('local')
        setLoadState('success')

        if (isAuthenticated()) {
          try {
            const serverEntities = await backendApi.get<ServerGraphEntity[]>(
              '/api/v1/knowledge/graph/entities',
            )
            const serverRelations = await backendApi.get<ServerGraphRelation[]>(
              '/api/v1/knowledge/graph/relations',
            )

            const sEntities: LocalEntity[] = (serverEntities ?? []).map(e => ({
              id: `srv-${e.id}`,
              name: e.name,
              type: e.type,
              properties: e.properties ?? {},
            }))

            const sEntityIds = new Set(sEntities.map(e => e.id))
            const sRelations: LocalRelation[] = (serverRelations ?? [])
              .filter(r => sEntityIds.has(`srv-${r.sourceId}`) && sEntityIds.has(`srv-${r.targetId}`))
              .map(r => ({
                id: `srv-${r.id}`,
                sourceId: `srv-${r.sourceId}`,
                targetId: `srv-${r.targetId}`,
                type: r.type,
              }))

            const localNameSet = new Set(mappedEntities.map(e => e.name.toLowerCase()))
            const newServerEntities = sEntities.filter(e => !localNameSet.has(e.name.toLowerCase()))
            const localRelKeys = new Set(mappedRelations.map(r => `${r.sourceId}-${r.type}-${r.targetId}`))
            const newServerRelations = sRelations.filter(r => !localRelKeys.has(`${r.sourceId}-${r.type}-${r.targetId}`))

            if (newServerEntities.length > 0 || newServerRelations.length > 0) {
              setEntities(prev => [...prev, ...newServerEntities])
              setRelations(prev => [...prev, ...newServerRelations])
              setDataSource('mixed')
            }
          } catch {
            setDataSource('local')
          }
        }
        return
      }

      if (!isAuthenticated()) {
        setEntities([])
        setRelations([])
        setDataSource('local')
        setLoadState('success')
        return
      }

      try {
        const serverEntities = await backendApi.get<ServerGraphEntity[]>(
          '/api/v1/knowledge/graph/entities',
        )
        const serverRelations = await backendApi.get<ServerGraphRelation[]>(
          '/api/v1/knowledge/graph/relations',
        )

        const mappedEntities: LocalEntity[] = (serverEntities ?? []).map(e => ({
          id: e.id,
          name: e.name,
          type: e.type,
          properties: e.properties ?? {},
        }))

        const validEntityIds = new Set(mappedEntities.map(e => e.id))
        const mappedRelations: LocalRelation[] = (serverRelations ?? [])
          .filter(r => validEntityIds.has(r.sourceId) && validEntityIds.has(r.targetId))
          .map(r => ({
            id: r.id,
            sourceId: r.sourceId,
            targetId: r.targetId,
            type: r.type,
          }))

        setEntities(mappedEntities)
        setRelations(mappedRelations)
        setDataSource('server')
        setLoadState('success')
      } catch {
        setLoadState('error')
        setErrorMsg(isZh ? '加载图谱数据失败' : 'Failed to load graph data')
      }
    } catch {
      setLoadState('error')
      setErrorMsg(isZh ? '加载图谱数据失败' : 'Failed to load graph data')
    }
  }, [isZh])

  useEffect(() => {
    fetchGraphData()
  }, [fetchGraphData])

  useEffect(() => {
    if (entities.length === 0) return

    const cx = (containerRef.current?.clientWidth || 600) / 2
    const cy = (containerRef.current?.clientHeight || 400) / 2

    nodesRef.current = entities.map((e: LocalEntity, i: number) => {
      const angle = (2 * Math.PI * i) / entities.length
      const spread = Math.min(200, entities.length * 15)
      return {
        id: e.id,
        name: e.name,
        type: e.type,
        x: cx + Math.cos(angle) * spread + (Math.random() - 0.5) * 40,
        y: cy + Math.sin(angle) * spread + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        radius: 6 + Math.min(4, relations.filter((r: LocalRelation) => r.sourceId === e.id || r.targetId === e.id).length),
      }
    })

    edgesRef.current = relations.map((r: LocalRelation) => ({
      source: r.sourceId,
      target: r.targetId,
      type: r.type,
    }))
  }, [entities, relations])

  const simulate = useCallback(() => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    if (nodes.length === 0) return

    const cx = (containerRef.current?.clientWidth || 600) / 2
    const cy = (containerRef.current?.clientHeight || 400) / 2

    for (const node of nodes) {
      if (dragNode === node.id) continue
      let fx = 0
      let fy = 0

      fx += (cx - node.x) * 0.001
      fy += (cy - node.y) * 0.001

      for (const other of nodes) {
        if (node.id === other.id) continue
        const dx = node.x - other.x
        const dy = node.y - other.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const minDist = 60
        if (dist < minDist) {
          const force = (minDist - dist) / dist * 0.3
          fx += dx * force
          fy += dy * force
        }
      }

      for (const edge of edges) {
        let otherId: string | null = null
        if (edge.source === node.id) otherId = edge.target
        else if (edge.target === node.id) otherId = edge.source
        if (!otherId) continue

        const other = nodes.find((n) => n.id === otherId)
        if (!other) continue

        const dx = other.x - node.x
        const dy = other.y - node.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const idealDist = 120
        const force = (dist - idealDist) * 0.002
        fx += (dx / dist) * force
        fy += (dy / dist) * force
      }

      node.vx = (node.vx + fx) * 0.85
      node.vy = (node.vy + fy) * 0.85
      node.x += node.vx
      node.y += node.vy
    }
  }, [dragNode])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = container.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)

    const nodes = nodesRef.current
    const edges = edgesRef.current

    for (const edge of edges) {
      const source = nodes.find((n) => n.id === edge.source)
      const target = nodes.find((n) => n.id === edge.target)
      if (!source || !target) continue

      const isHighlighted =
        hoveredNode === edge.source ||
        hoveredNode === edge.target ||
        selectedNode === edge.source ||
        selectedNode === edge.target

      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.strokeStyle = isHighlighted
        ? 'rgba(99, 102, 241, 0.6)'
        : 'rgba(100, 116, 139, 0.2)'
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5
      ctx.stroke()

      const midX = (source.x + target.x) / 2
      const midY = (source.y + target.y) / 2
      if (isHighlighted) {
        ctx.font = '12px sans-serif'
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)'
        ctx.textAlign = 'center'
        ctx.fillText(edge.type.replace(/_/g, ' '), midX, midY - 4)
      }
    }

    for (const node of nodes) {
      const isHovered = hoveredNode === node.id
      const isSelected = selectedNode === node.id
      const isConnected =
        hoveredNode
          ? edges.some(
              (e) =>
                (e.source === hoveredNode && e.target === node.id) ||
                (e.target === hoveredNode && e.source === node.id),
            )
          : false
      const isDimmed = hoveredNode && !isHovered && !isConnected && !isSelected

      const color = ENTITY_COLORS[node.type] || '#6b7280'
      const r = node.radius * (isHovered ? 1.4 : isSelected ? 1.3 : 1)

      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isDimmed ? 'rgba(100, 116, 139, 0.15)' : color
      ctx.globalAlpha = isDimmed ? 0.3 : 1
      ctx.fill()

      if (isHovered || isSelected) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      if (!isDimmed) {
        ctx.font = `${isHovered || isSelected ? 'bold ' : ''}12px sans-serif`
        ctx.fillStyle = isDimmed ? 'rgba(148, 163, 184, 0.3)' : 'rgba(226, 232, 240, 0.9)'
        ctx.textAlign = 'center'
        ctx.fillText(
          node.name.length > 16 ? node.name.slice(0, 14) + '…' : node.name,
          node.x,
          node.y + r + 12,
        )
      }
    }

    ctx.restore()
  }, [zoom, offset, hoveredNode, selectedNode])

  useEffect(() => {
    if (entities.length === 0) return

    let running = true
    const loop = () => {
      if (!running) return
      simulate()
      draw()
      animFrameRef.current = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [simulate, draw, entities.length])

  const getNodeAt = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left - offset.x) / zoom
      const y = (clientY - rect.top - offset.y) / zoom
      for (const node of nodesRef.current) {
        const dx = x - node.x
        const dy = y - node.y
        if (dx * dx + dy * dy < (node.radius + 4) * (node.radius + 4)) {
          return node
        }
      }
      return null
    },
    [zoom, offset],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        setDragNode(node.id)
        setSelectedNode(node.id)
        setIsDragging(true)
      } else {
        setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
        setIsDragging(true)
      }
    },
    [getNodeAt, offset],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) {
        const node = getNodeAt(e.clientX, e.clientY)
        setHoveredNode(node?.id || null)
        return
      }

      if (dragNode) {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = (e.clientX - rect.left - offset.x) / zoom
        const y = (e.clientY - rect.top - offset.y) / zoom
        const node = nodesRef.current.find((n) => n.id === dragNode)
        if (node) {
          node.x = x
          node.y = y
          node.vx = 0
          node.vy = 0
        }
      } else if (panStart) {
        setOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        })
      }
    },
    [isDragging, dragNode, panStart, getNodeAt, offset, zoom],
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragNode(null)
    setPanStart(null)
  }, [])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        const entity = entities.find((en: LocalEntity) => en.id === node.id)
        if (entity && onSelectEntity) onSelectEntity(entity)
      }
    },
    [getNodeAt, entities, onSelectEntity],
  )

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((prev) => Math.max(0.2, Math.min(3, prev * delta)))
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const selectedEntity = selectedNode
    ? entities.find((e: LocalEntity) => e.id === selectedNode)
    : null

  const renderLoading = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-text-muted animate-spin" />
        <p className="text-[13px] text-text-muted">{isZh ? '加载图谱数据...' : 'Loading graph data...'}</p>
      </div>
    </div>
  )

  const renderError = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-[13px] text-text-muted">{errorMsg}</p>
        <button
          onClick={fetchGraphData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-text-primary bg-surface-hover rounded-lg hover:bg-surface-active transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {isZh ? '重试' : 'Retry'}
        </button>
      </div>
    </div>
  )

  const renderEmpty = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-surface-hover flex items-center justify-center">
          <svg className="w-6 h-6 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <circle cx="4" cy="8" r="2" />
            <circle cx="20" cy="8" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
            <line x1="9.5" y1="11" x2="5.5" y2="9" />
            <line x1="14.5" y1="11" x2="18.5" y2="9" />
            <line x1="10" y1="14.5" x2="7.5" y2="16.5" />
            <line x1="14" y1="14.5" x2="16.5" y2="16.5" />
          </svg>
        </div>
        <p className="text-[13px] text-text-muted">{isZh ? '暂无图谱数据' : 'No graph data yet'}</p>
        <p className="text-[12px] text-text-muted/60 max-w-[240px] text-center">
          {isZh ? '添加知识条目后，系统会自动提取实体和关系构建知识图谱' : 'After adding knowledge entries, the system will automatically extract entities and relationships to build the knowledge graph'}
        </p>
      </div>
    </div>
  )

  const renderGraph = () => (
    <div className="flex-1 relative overflow-hidden" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />

      {hoveredNode && (
        <div className="absolute top-3 left-3 bg-surface/90 border border-border/30 rounded-lg px-3 py-2 pointer-events-none">
          <p className="text-[12px] font-medium text-text-primary">
            {entities.find((e: LocalEntity) => e.id === hoveredNode)?.name}
          </p>
          <p className="text-[12px] text-text-muted">
            {entities.find((e: LocalEntity) => e.id === hoveredNode)?.type}
          </p>
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5 bg-surface/80 border border-border/20 rounded-lg px-2 py-1.5">
        {Object.entries(ENTITY_COLORS).map(([type, color]) => {
          const count = entities.filter((e: LocalEntity) => e.type === type).length
          if (count === 0) return null
          return (
            <div
              key={type}
              className="flex items-center gap-1 text-[12px] text-text-muted"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {type}({count})
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between flex-shrink-0">
        <h3 className="text-[14px] font-semibold text-text-primary">
          {isZh ? '知识图谱' : 'Knowledge Graph'}
        </h3>
        <div className="flex items-center gap-1.5">
          {loadState === 'success' && (
            <span className="text-[12px] text-text-muted mr-2">
              {isZh ? `${entities.length} 实体 · ${relations.length} 关系` : `${entities.length} entities · ${relations.length} relations`}
              <span className="ml-1.5 inline-flex items-center gap-0.5">
                {dataSource === 'local' && <Database className="w-3 h-3 text-emerald-400" />}
                {dataSource === 'server' && <Cloud className="w-3 h-3 text-blue-400" />}
                {dataSource === 'mixed' && <><Database className="w-3 h-3 text-emerald-400" /><Cloud className="w-3 h-3 text-blue-400" /></>}
              </span>
            </span>
          )}
          {loadState === 'success' && (
            <>
              <button
                onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={resetView}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loadState === 'loading' && renderLoading()}
      {loadState === 'error' && renderError()}
      {loadState === 'success' && entities.length === 0 && renderEmpty()}
      {loadState === 'success' && entities.length > 0 && renderGraph()}

      {selectedEntity && (
        <div className="px-5 py-3 border-t border-border/30 bg-surface/50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor: ENTITY_COLORS[selectedEntity.type] || '#6b7280',
              }}
            />
            <span className="text-[13px] font-medium text-text-primary">
              {selectedEntity.name}
            </span>
            <span className="text-[12px] text-text-muted">
              {selectedEntity.type}
            </span>
          </div>
          <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">
            {Object.entries(selectedEntity.properties)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}
