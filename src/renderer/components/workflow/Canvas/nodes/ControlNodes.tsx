import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, StackedSourceHandles, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const DelayNode = memo(function DelayNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('delay')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('delay')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="delay" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="delay" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="delay" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="delay" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.delayMs && <NodeInfoRow label="delay" value={`${nodeData.delayMs}ms`} color={color} />}
        </NodeBody>
      )}
    </div>
  )
})

export const WebhookTriggerNode = memo(function WebhookTriggerNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('webhook_trigger')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('webhook_trigger')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="webhook_trigger" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="webhook_trigger" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="webhook_trigger" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="webhook_trigger" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.webhookPath && <NodeInfoRow label="path" value={nodeData.webhookPath} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const EventWaitNode = memo(function EventWaitNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('event_wait')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('event_wait')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="event_wait" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="event_wait" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="event_wait"
            handles={[
              { handleId: 'out', connected: nodeData._connectedSourceHandleIds?.includes('out') || false },
              { handleId: 'timeout', connected: nodeData._connectedSourceHandleIds?.includes('timeout') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="event_wait" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.eventType && <NodeInfoRow label="event" value={nodeData.eventType} color={color} />}
          {nodeData.eventTimeout && <NodeInfoRow label="timeout" value={`${nodeData.eventTimeout / 1000}s`} />}
        </NodeBody>
      )}
    </div>
  )
})