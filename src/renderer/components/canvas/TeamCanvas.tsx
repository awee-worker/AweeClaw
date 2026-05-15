import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react'
import { collaborationCanvasEngine, type CanvasNode, type CanvasEdge, type CollaborationLayout, type AgentNodeData, type TaskNodeData } from '@intelligence/multiAgent/CollaborationCanvasEngine'

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  idle: Clock,
  active: Loader2,
  completed: CheckCircle2,
  error: XCircle,
}

const STATUS_COLOR: Record<string, string> = {
  idle: 'text-gray-400',
  active: 'text-blue-400',
  completed: 'text-green-400',
  error: 'text-red-400',
}

function AgentNode({ node, isSelected, onSelect, onDrag }: {
  node: CanvasNode
  isSelected: boolean
  onSelect: (id: string) => void
  onDrag: (id: string, x: number, y: number) => void
}) {
  const data = node.data as AgentNodeData
  const StatusIcon = STATUS_ICON[node.status] || Clock
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, nodeX: node.x, nodeY: node.y }

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      onDrag(node.id, dragStart.current.nodeX + dx, dragStart.current.nodeY + dy)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [node.id, node.x, node.y, onDrag])

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onMouseDown={handleMouseDown}
      onClick={() => onSelect(node.id)}
      className={`cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
    >
      <rect
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        rx={12}
        fill="rgba(17, 24, 39, 0.9)"
        stroke={isSelected ? node.color : 'rgba(75, 85, 99, 0.5)'}
        strokeWidth={isSelected ? 2 : 1}
        className="transition-all"
      />
      <rect
        x={0}
        y={0}
        width={node.width}
        height={3}
        rx={1.5}
        fill={node.color}
      />
      <foreignObject x={12} y={12} width={node.width - 24} height={node.height - 24}>
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 shrink-0" style={{ color: node.color }} />
            <span className="text-sm font-medium text-gray-200 truncate">{data.roleName}</span>
            <div className="flex-1" />
            <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${STATUS_COLOR[node.status]} ${node.status === 'active' ? 'animate-spin' : ''}`} />
          </div>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{data.roleDescription}</p>
          <div className="flex items-center gap-2 mt-auto text-xs text-gray-500">
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{data.messageCount}</span>
          </div>
        </div>
      </foreignObject>
    </g>
  )
}

function TaskNode({ node, isSelected, onSelect }: {
  node: CanvasNode
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const data = node.data as TaskNodeData

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onClick={() => onSelect(node.id)}
      className="cursor-pointer"
    >
      <rect
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        rx={8}
        fill="rgba(17, 24, 39, 0.85)"
        stroke={isSelected ? '#3b82f6' : 'rgba(75, 85, 99, 0.4)'}
        strokeWidth={isSelected ? 2 : 1}
      />
      <foreignObject x={10} y={8} width={node.width - 20} height={node.height - 16}>
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${node.status === 'active' ? 'bg-blue-400 animate-pulse' : node.status === 'completed' ? 'bg-green-400' : node.status === 'error' ? 'bg-red-400' : 'bg-gray-400'}`} />
            <span className="text-xs font-medium text-gray-300 truncate">{data.description.slice(0, 40)}</span>
          </div>
          {data.result && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{data.result.slice(0, 60)}</p>
          )}
        </div>
      </foreignObject>
    </g>
  )
}

function EdgeRenderer({ edge, nodes }: { edge: CanvasEdge; nodes: CanvasNode[] }) {
  const sourceNode = nodes.find(n => n.id === edge.source)
  const targetNode = nodes.find(n => n.id === edge.target)
  if (!sourceNode || !targetNode) return null

  const sx = sourceNode.x + sourceNode.width / 2
  const sy = sourceNode.y + sourceNode.height / 2
  const tx = targetNode.x + targetNode.width / 2
  const ty = targetNode.y + targetNode.height / 2

  const edgeColor = edge.type === 'communication' ? '#8b5cf6' :
    edge.type === 'task_assignment' ? '#3b82f6' :
      edge.type === 'dependency' ? '#6b7280' : '#10b981'

  return (
    <g>
      <line
        x1={sx}
        y1={sy}
        x2={tx}
        y2={ty}
        stroke={edgeColor}
        strokeWidth={1.5}
        strokeDasharray={edge.type === 'dependency' ? '4 4' : undefined}
        opacity={0.6}
      />
      {edge.animated && (
        <circle r={3} fill={edgeColor}>
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={`M${sx},${sy} L${tx},${ty}`}
          />
        </circle>
      )}
      {edge.label && (
        <text
          x={(sx + tx) / 2}
          y={(sy + ty) / 2 - 6}
          textAnchor="middle"
          className="text-[10px] fill-gray-500"
        >
          {edge.label}
        </text>
      )}
    </g>
  )
}

export default function CollaborationCanvas({ sessionId }: { sessionId?: string }) {
  const [layout, setLayout] = useState<CollaborationLayout | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const unsub = collaborationCanvasEngine.subscribe((updatedLayout) => {
      setLayout({ ...updatedLayout })
    })
    return unsub
  }, [])

  const handleDrag = useCallback((nodeId: string, x: number, y: number) => {
    if (sessionId) {
      collaborationCanvasEngine.updateNodePosition(sessionId, nodeId, x, y)
    }
  }, [sessionId])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.max(0.3, Math.min(3, z * delta)))
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Start a collaboration session to see the canvas</p>
        </div>
      </div>
    )
  }

  const agentNodes = layout.nodes.filter(n => n.type === 'agent')
  const taskNodes = layout.nodes.filter(n => n.type === 'task')
  const selectedNode = layout.nodes.find(n => n.id === selectedNodeId)

  return (
    <div className="flex flex-col h-full bg-gray-900/50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-200">Collaboration Canvas</span>
          <span className="text-xs text-gray-500">{agentNodes.length} agents</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.min(3, z * 1.2))}
            className="p-1 rounded hover:bg-white/10 text-gray-400"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
            className="p-1 rounded hover:bg-white/10 text-gray-400"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetView}
            className="p-1 rounded hover:bg-white/10 text-gray-400"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          onWheel={handleWheel}
          style={{ cursor: 'grab' }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#6b7280" opacity={0.6} />
              </marker>
            </defs>

            {layout.edges.map(edge => (
              <EdgeRenderer key={edge.id} edge={edge} nodes={layout.nodes} />
            ))}

            {taskNodes.map(node => (
              <TaskNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={setSelectedNodeId}
              />
            ))}

            {agentNodes.map(node => (
              <AgentNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={setSelectedNodeId}
                onDrag={handleDrag}
              />
            ))}
          </g>
        </svg>
      </div>

      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-700/50 overflow-hidden"
          >
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-200">
                  {selectedNode.type === 'agent' ? (selectedNode.data as AgentNodeData).roleName : (selectedNode.data as TaskNodeData).description.slice(0, 50)}
                </span>
                <button onClick={() => setSelectedNodeId(null)} className="text-gray-400 hover:text-gray-200">
                  ✕
                </button>
              </div>
              <div className="text-xs text-gray-400">
                {selectedNode.type === 'agent' && (
                  <>
                    <p>{(selectedNode.data as AgentNodeData).roleDescription}</p>
                    <p className="mt-1">Messages: {(selectedNode.data as AgentNodeData).messageCount}</p>
                  </>
                )}
                {selectedNode.type === 'task' && (
                  <>
                    <p>{(selectedNode.data as TaskNodeData).description}</p>
                    {(selectedNode.data as TaskNodeData).result && (
                      <p className="mt-1 text-gray-300">{(selectedNode.data as TaskNodeData).result!.slice(0, 200)}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
