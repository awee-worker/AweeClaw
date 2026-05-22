import { memo } from 'react'
import { getBezierPath, Position, type ConnectionLineComponentProps } from '@xyflow/react'

const CustomConnectionLine = memo(function CustomConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: Position.Right,
    targetX: toX,
    targetY: toY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })

  const midX = (fromX + toX) / 2
  const midY = (fromY + toY) / 2

  return (
    <g>
      <path
        fill="none"
        stroke="#6366f1"
        strokeWidth={2}
        strokeDasharray="8 4"
        d={edgePath}
        opacity={0.7}
        className="ant-flow-edge"
      />
      <circle
        cx={toX}
        cy={toY}
        r={5}
        fill="#6366f1"
        stroke="#fff"
        strokeWidth={2}
        opacity={0.9}
      />
      <circle r={2.5} fill="#6366f1" opacity={0.7}>
        <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
      </circle>
      <text
        x={midX}
        y={midY - 10}
        textAnchor="middle"
        fontSize={10}
        fill="#6366f1"
        opacity={0.7}
        fontWeight={500}
      >
        release to connect
      </text>
    </g>
  )
})

export default CustomConnectionLine