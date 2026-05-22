import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const TextOutputNode = memo(function TextOutputNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('text_output')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('text_output')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="text_output" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="text_output" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="text_output" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.outputFormat && <NodeInfoRow label="format" value={nodeData.outputFormat} color={color} />}
        </NodeBody>
      )}
    </div>
  )
})

export const FileOutputNode = memo(function FileOutputNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('file_output')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('file_output')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="file_output" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="file_output" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="file_output" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.fileFormat && <NodeInfoRow label="format" value={nodeData.fileFormat} color={color} />}
          {nodeData.filePath && <NodeInfoRow label="path" value={nodeData.filePath} />}
        </NodeBody>
      )}
    </div>
  )
})

export const NotificationNode = memo(function NotificationNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('notification')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('notification')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="notification" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="notification" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="notification" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.notificationChannel && <NodeInfoRow label="channel" value={nodeData.notificationChannel} color={color} />}
          {(nodeData.recipients?.length ?? 0) > 0 && <NodeInfoRow label="to" value={`${nodeData.recipients!.length}`} />}
        </NodeBody>
      )}
    </div>
  )
})