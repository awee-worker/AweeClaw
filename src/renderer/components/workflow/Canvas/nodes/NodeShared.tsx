import React, { memo, useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position } from '@xyflow/react'
import type { WorkflowNodeTypeV2, WorkflowNodeData } from '@shared/protocols/workflowV2'
import { getNodeColor, getNodeIcon, getNodeLabel } from '../../shared/nodeTypes'
import { NodeSvgIcon } from './NodeSvgIcon'
import { Trash2, Copy, ChevronDown, Plus, X } from 'lucide-react'
import {
  NODE_CATEGORY_MAP,
  NODE_TYPE_LABELS,
  NODE_CATEGORY_LABELS,
} from '@shared/protocols/workflowV2'

export type NodeData = WorkflowNodeData & {
  label?: string
  _customLabel?: string
  nodeType?: WorkflowNodeTypeV2
  _selected?: boolean
  _connectedTargetHandleIds?: string[]
  _connectedSourceHandleIds?: string[]
  _expanded?: boolean
  _workflowVariables?: { name: string; type: string; defaultValue?: unknown; description?: string; scope: string }[]
  path?: string
  eventName?: string
  timeoutSeconds?: number
  parallelTasks?: number
  runtime?: string
  branches?: unknown[]
  transformOperation?: string
  maxCount?: number
}

export const NODE_CLASS = [
  'rounded-2xl',
  'border border-gray-200/80',
  'bg-white',
  'shadow-sm',
  'transition-all duration-200',
  'min-w-[220px] max-w-[260px]',
  'overflow-visible',
  'cursor-default',
].join(' ')

const HANDLE_HIT_AREA = 14

class NodeHandleStyles {
  static readonly BASE: CSSProperties = {
    width: HANDLE_HIT_AREA,
    height: HANDLE_HIT_AREA,
    borderRadius: '50%',
    cursor: 'crosshair',
    zIndex: 10,
    transition: 'all 0.15s ease',
  }

  static readonly TARGET: CSSProperties = {
    ...this.BASE,
    left: -HANDLE_HIT_AREA / 2,
  }

  static readonly SOURCE: CSSProperties = {
    ...this.BASE,
    right: -HANDLE_HIT_AREA / 2,
  }
}

function getHandleStyle(connected: boolean, nodeColor: string, isHovered?: boolean): CSSProperties {
  if (connected) {
    return {
      ...NodeHandleStyles.BASE,
      background: nodeColor,
      border: `2px solid ${nodeColor}`,
      boxShadow: `0 0 6px ${nodeColor}40`,
    }
  }
  if (isHovered) {
    return {
      ...NodeHandleStyles.BASE,
      background: '#fff',
      border: `2px solid ${nodeColor}`,
      boxShadow: `0 0 8px ${nodeColor}30`,
      transform: 'scale(1.25)',
    }
  }
  return {
    ...NodeHandleStyles.BASE,
    background: '#fff',
    border: '2px solid #cbd5e1',
  }
}

export const ENHANCED_HANDLE_SIZE = 9
export const ENHANCED_HANDLE_HOVER = 15

export function emitUpdate(nodeId: string, data: Record<string, unknown>) {
  document.dispatchEvent(
    new CustomEvent('wf-update-node-data', { detail: { nodeId, data } }),
  )
}

export function emitAddConnectedNode(
  sourceNodeId: string,
  nodeType: WorkflowNodeTypeV2,
  sourceHandleId?: string,
) {
  document.dispatchEvent(
    new CustomEvent('wf-add-connected-node', {
      detail: { sourceNodeId, nodeType, sourceHandleId },
    }),
  )
}

export function useScrollCapture() {
  const containerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const atTop = scrollTop <= 0
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1

      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        return
      }
      e.stopPropagation()
    }

    el.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  })

  const callbackRef = useCallback((el: HTMLElement | null) => {
    containerRef.current = el
  }, [])

  return callbackRef
}

export function useNodeScrollGuard() {
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      const scrollable = target.closest('.no-wheel')
      if (!scrollable) return

      const { scrollTop, scrollHeight, clientHeight } = scrollable
      const atTop = scrollTop <= 0
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1

      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        return
      }
      e.stopImmediatePropagation()
    }

    document.addEventListener('wheel', handler, { passive: true })
    return () => document.removeEventListener('wheel', handler)
  }, [])
}

type PickerNodeType = Exclude<WorkflowNodeTypeV2, 'start'>

const CATEGORY_ORDER = [
  'agent',
  'interaction',
  'flow',
  'tool',
  'data',
  'control',
  'output',
] as const

const pickerNodeTypes = (Object.keys(NODE_CATEGORY_MAP) as WorkflowNodeTypeV2[]).filter(
  (t) => t !== 'start',
) as PickerNodeType[]

export const groupedPickerTypes = CATEGORY_ORDER.map((cat) => ({
  key: cat,
  label: NODE_CATEGORY_LABELS[cat]?.zh || cat,
  types: pickerNodeTypes.filter(
    (t) => NODE_CATEGORY_MAP[t].category === cat,
  ),
})).filter((g) => g.types.length > 0)

export function NodePickerContent({
  onSelect,
  onClose,
}: {
  onSelect: (nodeType: PickerNodeType) => void
  onClose: () => void
}) {
  const listRef = useScrollCapture()

  return (
    <div
      className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden w-52"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
        <span className="text-[11px] font-semibold text-gray-600">
          选择下一个节点
        </span>
        <button
          onClick={onClose}
          className="w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div
        ref={listRef}
        className="nodrag no-wheel overflow-y-auto max-h-[280px] p-1"
      >
        {groupedPickerTypes.map((group) => (
          <div key={group.key} className="mb-0.5">
            <div className="px-2 py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.types.map((nt) => {
                const cfg = NODE_CATEGORY_MAP[nt]
                const lbl = NODE_TYPE_LABELS[nt]
                return (
                  <button
                    key={nt}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(nt)
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 text-left transition-colors group"
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0 group-hover:scale-125 transition-transform"
                      style={{ backgroundColor: cfg.color }}
                    />
                    <span className="text-[11px] text-gray-700 truncate">
                      {lbl.zh}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceHandleButton({
  handleId,
  connected,
  color,
  hovered,
}: {
  handleId: string
  connected: boolean
  color: string
  hovered: boolean
}) {
  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        id={handleId}
        className="!pointer-events-auto"
        style={{
          width: hovered ? ENHANCED_HANDLE_HOVER : ENHANCED_HANDLE_SIZE,
          height: hovered ? ENHANCED_HANDLE_HOVER : ENHANCED_HANDLE_SIZE,
          borderRadius: '50%',
          background: connected ? color : '#fff',
          border: `2px solid ${connected ? color : hovered ? color : '#cbd5e1'}`,
          boxShadow: hovered ? `0 0 10px ${color}50` : connected ? `0 0 6px ${color}40` : 'none',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          top: 'auto',
          right: 'auto',
          position: 'static',
          transform: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        isConnectable={true}
      />
      {hovered && (
        <Plus className="absolute w-2.5 h-2.5 pointer-events-none" style={{ color }} strokeWidth={3} />
      )}
    </>
  )
}

export function SourceHandleWithPicker({
  nodeId,
  nodeType,
  handleId,
  connected,
}: {
  nodeId: string
  nodeType: WorkflowNodeTypeV2
  handleId: string
  connected: boolean
}) {
  const color = getNodeColor(nodeType)
  const [hovered, setHovered] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPicker) return

    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setPickerPos({
        left: rect.right + 6,
        top: rect.top + rect.height / 2 - 140,
      })
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        pickerRef.current && !pickerRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [showPicker])

  const handleHoverEnter = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHovered(true)
  }, [])

  const handleHoverLeave = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHovered(false)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setShowPicker((prev) => !prev)
  }, [])

  const handleSelect = useCallback(
    (selectedType: PickerNodeType) => {
      emitAddConnectedNode(nodeId, selectedType, handleId)
      setShowPicker(false)
    },
    [nodeId, handleId],
  )

  return (
    <>
      <div
        ref={anchorRef}
        className="absolute flex items-center justify-center z-20"
        style={{
          right: -(ENHANCED_HANDLE_HOVER / 2 + 3),
          top: '50%',
          transform: 'translateY(-50%)',
          width: ENHANCED_HANDLE_HOVER + 8,
          height: ENHANCED_HANDLE_HOVER + 8,
        }}
        onClick={handleClick}
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
      >
        <SourceHandleButton handleId={handleId} connected={connected} color={color} hovered={hovered} />
      </div>
      {showPicker &&
        createPortal(
          <div
            ref={pickerRef}
            className="fixed"
            style={{ left: pickerPos.left, top: pickerPos.top, zIndex: 99999 }}
          >
            <NodePickerContent
              onSelect={handleSelect}
              onClose={() => setShowPicker(false)}
            />
          </div>,
          document.body,
        )}
    </>
  )
}

export function StackedSourceHandles({
  nodeId,
  nodeType,
  handles,
}: {
  nodeId: string
  nodeType: WorkflowNodeTypeV2
  handles: Array<{ handleId: string; connected: boolean }>
}) {
  return (
    <div
      className="absolute flex flex-col z-20"
      style={{ right: -(ENHANCED_HANDLE_HOVER / 2 + 3), top: '50%', transform: 'translateY(-50%)', gap: 4 }}
    >
      {handles.map((h) => (
        <SourceHandleWithPicker
          key={h.handleId}
          nodeId={nodeId}
          nodeType={nodeType}
          handleId={h.handleId}
          connected={h.connected}
        />
      ))}
    </div>
  )
}

export function NodeTargetHandle({
  id,
  nodeType,
  connected,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string
  nodeType: WorkflowNodeTypeV2
  connected: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const color = getNodeColor(nodeType)
  const [hovered, setHovered] = React.useState(false)

  return (
    <Handle
      type="target"
      position={Position.Left}
      id={id}
      style={getHandleStyle(connected, color, hovered)}
      isConnectable={true}
      onMouseEnter={() => { setHovered(true); onMouseEnter?.() }}
      onMouseLeave={() => { setHovered(false); onMouseLeave?.() }}
    />
  )
}

export function HeaderTargetHandle({
  id,
  nodeType,
  connected,
}: {
  id: string
  nodeType: WorkflowNodeTypeV2
  connected: boolean
}) {
  const color = getNodeColor(nodeType)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="absolute flex items-center justify-center z-20"
      style={{
        left: -(ENHANCED_HANDLE_HOVER / 2 + 3),
        top: '50%',
        transform: 'translateY(-50%)',
        width: ENHANCED_HANDLE_HOVER + 8,
        height: ENHANCED_HANDLE_HOVER + 8,
      }}
      onMouseEnter={(e) => { e.stopPropagation(); setHovered(true) }}
      onMouseLeave={(e) => { e.stopPropagation(); setHovered(false) }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={id}
        className="!pointer-events-auto"
        style={{
          width: hovered ? ENHANCED_HANDLE_HOVER : ENHANCED_HANDLE_SIZE,
          height: hovered ? ENHANCED_HANDLE_HOVER : ENHANCED_HANDLE_SIZE,
          borderRadius: '50%',
          background: connected ? color : hovered ? '#fff' : '#fff',
          border: `2px solid ${connected ? color : hovered ? color : '#cbd5e1'}`,
          boxShadow: hovered
            ? `0 0 10px ${color}50`
            : connected
              ? `0 0 6px ${color}40`
              : 'none',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          top: 'auto',
          left: 'auto',
          position: 'static',
          transform: 'none',
        }}
        isConnectable={true}
      />
    </div>
  )
}

export function NodeSourceHandle({
  id,
  nodeType,
  connected,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string
  nodeType: WorkflowNodeTypeV2
  connected: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const color = getNodeColor(nodeType)
  const [hovered, setHovered] = React.useState(false)

  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      style={getHandleStyle(connected, color, hovered)}
      isConnectable={true}
      onMouseEnter={() => { setHovered(true); onMouseEnter?.() }}
      onMouseLeave={() => { setHovered(false); onMouseLeave?.() }}
    />
  )
}

export function MultiSourceHandles({
  handles,
}: {
  handles: Array<{ id: string; label: string; color: string; connected?: boolean }>
}) {
  const count = handles.length
  const spacing = 44
  const totalHeight = (count - 1) * spacing
  const startY = -(totalHeight / 2)

  return (
    <div
      className="absolute right-0 top-1/2 z-10 flex flex-col"
      style={{ transform: 'translateY(-50%)', gap: 0 }}
    >
      {handles.map((h, i) => {
        const offsetY = startY + i * spacing
        return (
          <div
            key={h.id}
            className="absolute flex items-center"
            style={{ right: 0, top: `calc(50% + ${offsetY}px)`, transform: 'translateY(-50%)' }}
          >
            <span className="text-[9px] font-semibold mr-1.5 pointer-events-none select-none" style={{ color: h.color }}>
              {h.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={h.id}
              style={{
                ...NodeHandleStyles.SOURCE,
                background: h.connected ? h.color : '#fff',
                border: `2px solid ${h.connected ? h.color : '#cbd5e1'}`,
                boxShadow: h.connected ? `0 0 6px ${h.color}40` : 'none',
                right: 'auto',
              }}
              isConnectable={true}
            />
          </div>
        )
      })}
    </div>
  )
}

export function MultiTargetHandles({
  handles,
}: {
  handles: Array<{ id: string; label: string; color: string; connected?: boolean }>
}) {
  const count = handles.length
  const spacing = 44
  const totalHeight = (count - 1) * spacing
  const startY = -(totalHeight / 2)

  return (
    <div
      className="absolute left-0 top-1/2 z-10 flex flex-col"
      style={{ transform: 'translateY(-50%)', gap: 0 }}
    >
      {handles.map((h, i) => {
        const offsetY = startY + i * spacing
        return (
          <div
            key={h.id}
            className="absolute flex items-center"
            style={{ left: 0, top: `calc(50% + ${offsetY}px)`, transform: 'translateY(-50%)' }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={h.id}
              style={{
                ...NodeHandleStyles.TARGET,
                background: h.connected ? h.color : '#fff',
                border: `2px solid ${h.connected ? h.color : '#cbd5e1'}`,
                boxShadow: h.connected ? `0 0 6px ${h.color}40` : 'none',
                left: 'auto',
              }}
              isConnectable={true}
            />
            <span className="text-[9px] font-semibold ml-1.5 pointer-events-none select-none" style={{ color: h.color }}>
              {h.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface BaseNodeProps {
  id: string
  nodeType: WorkflowNodeTypeV2
  label: string
  selected?: boolean
  onDelete?: () => void
  onDuplicate?: () => void
  children?: React.ReactNode
  headerExtra?: React.ReactNode
}

export const BaseNode = memo(function BaseNode({
  id: _id,
  nodeType,
  label,
  selected,
  onDelete,
  onDuplicate,
  children,
  headerExtra,
}: BaseNodeProps) {
  const color = getNodeColor(nodeType)

  return (
    <div
      className={[
        'relative rounded-2xl border bg-white shadow-sm transition-all duration-200',
        'min-w-[220px] max-w-[260px]',
        selected
          ? 'shadow-md'
          : 'hover:shadow-md group',
      ].join(' ')}
      style={{
        borderColor: selected ? color : undefined,
        boxShadow: selected
          ? `0 0 0 3px ${color}18, 0 4px 12px rgba(0,0,0,0.08)`
          : undefined,
      }}
    >
      <div
        className="absolute -top-7 right-0 flex h-6 items-center rounded-lg border border-gray-200/80 bg-white/95 px-0.5 text-gray-400 shadow-md backdrop-blur-[5px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20"
        style={{ opacity: selected ? 1 : undefined }}
      >
        {onDuplicate && (
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-gray-100 hover:text-gray-600 cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); onDuplicate() }}
            title="复制"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-red-50 hover:text-red-500 cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete?.() }}
          title="删除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <NodeHeader nodeType={nodeType} label={label} color={color} selected={!!selected} />
      {headerExtra}
      {children && <NodeBody>{children}</NodeBody>}
    </div>
  )
})

interface NodeControlBarProps {
  nodeId: string
}

const NodeControlBar = memo(function NodeControlBar({ nodeId }: NodeControlBarProps) {
  return (
    <div
      className="absolute -top-7 right-0 flex h-6 items-center rounded-lg border border-gray-200/80 bg-white/95 px-0.5 text-gray-400 shadow-md backdrop-blur-[5px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20"
    >
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-gray-100 hover:text-gray-600 cursor-pointer transition-colors"
        onClick={(e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('wf-duplicate-node', { detail: nodeId })) }}
        title="复制"
      >
        <Copy className="h-3 w-3" />
      </button>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-red-50 hover:text-red-500 cursor-pointer transition-colors"
        onClick={(e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('wf-delete-node', { detail: nodeId })) }}
        title="删除"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
})

export function NodeHeader({
  nodeType,
  label,
  color,
  selected: _selected,
  expanded,
  onToggleExpand,
  targetHandle,
  sourceHandle,
  onRename,
}: {
  nodeType: WorkflowNodeTypeV2
  label: string
  color: string
  selected: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  targetHandle?: React.ReactNode
  sourceHandle?: React.ReactNode
  onRename?: (newName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setEditValue(label)
    setEditing(true)
  }, [label])

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) {
      onRename?.(trimmed)
    }
    setEditing(false)
  }, [editValue, label, onRename])

  const handleCancel = useCallback(() => {
    setEditValue(label)
    setEditing(false)
  }, [label])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
    e.stopPropagation()
  }, [handleSave, handleCancel])

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 relative">
      {targetHandle}
      <div
        className="flex items-center justify-center w-6 h-6 rounded-lg flex-shrink-0 shadow-sm"
        style={{ backgroundColor: color, color: '#fff' }}
      >
        <NodeSvgIcon iconName={getNodeIcon(nodeType)} size={13} className="text-white" />
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-5 px-1.5 text-[11px] rounded border border-blue-400 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400/30 transition-all"
          />
        ) : (
          <span
            onClick={onRename ? handleStartEdit : undefined}
            className={[
              'text-[11px] font-semibold text-gray-800 truncate leading-tight',
              onRename ? 'cursor-pointer hover:text-blue-600 hover:bg-blue-50/50 rounded px-0.5 -mx-0.5 transition-colors' : '',
            ].join(' ')}
            title={onRename ? '点击修改名称' : undefined}
          >
            {label}
          </span>
        )}
      </div>
      {onToggleExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
          className={`w-5 h-5 flex items-center justify-center rounded-md text-gray-350 hover:text-gray-600 hover:bg-gray-100 transition-all flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      )}
      {sourceHandle}
    </div>
  )
}

export function NodeBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="nodrag no-wheel px-3 pb-2.5 space-y-0.5 min-w-0">
      <div className="border-t border-gray-100 pt-1.5 min-w-0">{children}</div>
    </div>
  )
}

export function NodeInfoRow({ label, value, color, mono }: { label: string; value: React.ReactNode; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] leading-relaxed min-w-0">
      <span className="text-gray-400 font-medium flex-shrink-0 whitespace-nowrap min-w-[34px]">{label}</span>
      <span className={`truncate font-medium min-w-0 ${mono ? 'font-mono' : ''}`} style={{ color: color || '#6b7280' }}>
        {value}
      </span>
    </div>
  )
}

export { memo, getNodeColor, getNodeLabel }
export type { WorkflowNodeTypeV2 }
export { NodeControlBar }

export function toggleNodeExpand(nodeId: string, currentExpanded: boolean) {
  document.dispatchEvent(
    new CustomEvent('wf-update-node-data', {
      detail: { nodeId, data: { _expanded: !currentExpanded } },
    }),
  )
}