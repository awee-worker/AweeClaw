import { memo, useState, useCallback, useMemo } from 'react'
import {
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type EdgeProps,
} from '@xyflow/react'
import { Plus } from 'lucide-react'

export const ConditionEdge = memo(function ConditionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps & { data?: Record<string, unknown> }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })

  const handleType = (data as Record<string, string>)?.handleType || 'then'
  const isThen = handleType === 'then'
  const edgeColor = isThen ? '#10b981' : '#ef4444'
  const labelText = isThen ? 'Yes' : 'No'

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        strokeDasharray="6 3"
        className="react-flow__edge-path ant-flow-edge"
        style={{
          stroke: selected ? edgeColor : `${edgeColor}99`,
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <circle r={3} fill={edgeColor} opacity={0.7}>
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <span
            className="px-1.5 py-0.5 text-[9px] font-bold rounded-full inline-block"
            style={{
              backgroundColor: `${edgeColor}20`,
              color: edgeColor,
              border: `1px solid ${edgeColor}40`,
            }}
          >
            {labelText}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

export const DefaultEdge = memo(function DefaultEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data: _data,
  selected,
  style: _style,
}: EdgeProps & { data?: Record<string, unknown> }) {
  const [isHovered, setIsHovered] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })

  const markerEndId = useMemo(() => `arrow-${id}`, [id])

  const strokeColor = selected ? '#6366f1' : isHovered ? '#8b5cf6' : '#818cf8'
  const strokeWidth = selected ? 2.5 : isHovered ? 2.2 : 1.8
  const arrowColor = strokeColor

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  return (
    <>
      <defs>
        <marker
          id={markerEndId}
          viewBox="0 0 10 8"
          refX="9"
          refY="4"
          markerWidth="5"
          markerHeight="4"
          orient="auto"
        >
          <path d="M0,0 L10,4 L0,8 L3,4 Z" fill={arrowColor} />
        </marker>
      </defs>

      <g onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: 'pointer' }}
        />
      </g>

      <path
        id={id}
        d={edgePath}
        fill="none"
        strokeDasharray="8 4"
        markerEnd={`url(#${markerEndId})`}
        className="react-flow__edge-path ant-flow-edge"
        style={{
          stroke: strokeColor,
          strokeWidth,
          transition: 'stroke 0.25s, stroke-width 0.25s',
        }}
      />

      <circle cx={sourceX - 8} cy={sourceY} r={2} fill={strokeColor} opacity={0.5} />

      {isHovered && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              opacity: 1,
              transition: 'opacity 0.15s',
            }}
          >
            <button
              className="flex items-center justify-center w-5 h-5 rounded-full bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-purple-400 hover:bg-purple-50 transition-all cursor-pointer"
              title="插入节点"
            >
              <Plus className="w-3 h-3 text-gray-400 hover:text-purple-500" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const AnimatedEdge = memo(function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })

  const color = selected ? '#14b8a6' : '#14b8a699'

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        strokeDasharray="6 3"
        className="react-flow__edge-path ant-flow-edge"
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <circle r={3} fill="#14b8a6" opacity={0.8}>
        <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  )
})

export const edgeTypeComponents: Record<string, React.ComponentType<EdgeProps>> = {
  default: DefaultEdge,
  condition: ConditionEdge,
  parallel: AnimatedEdge,
  'loop-back': AnimatedEdge,
}
