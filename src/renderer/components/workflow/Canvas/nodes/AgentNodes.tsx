import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

export const AgentTaskNode = memo(function AgentTaskNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('agent_task')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('agent_task')
  const expanded = !!nodeData._expanded

  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[
        'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group',
        'min-w-[220px]',
        expanded ? 'max-w-[400px]' : 'max-w-[260px]',
        selected ? 'shadow-md' : 'hover:shadow-md',
      ].join(' ')}
      style={{
        borderColor: selected ? color : '#e5e7eb',
        boxShadow: selected ? `0 0 0 3px ${color}18, 0 4px 12px rgba(0,0,0,0.08)` : undefined,
      }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="agent_task" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="agent_task" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="agent_task" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="agent_task" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.roleId && <NodeInfoRow label="role" value={nodeData.roleId} color={color} />}
          {nodeData.modelId && <NodeInfoRow label="model" value={nodeData.modelId} />}
          {(nodeData.boundTools?.length ?? 0) > 0 && <NodeInfoRow label="tools" value={`${nodeData.boundTools!.length}`} color="#14b8a6" />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const AgentGroupNode = memo(function AgentGroupNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('agent_group')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('agent_group')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={['relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group', 'min-w-[220px]', expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="agent_group" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="agent_group" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="agent_group" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="agent_group" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.collaborationMode && <NodeInfoRow label="mode" value={nodeData.collaborationMode} color={color} />}
          {nodeData.maxRounds && <NodeInfoRow label="rounds" value={`${nodeData.maxRounds}`} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const SubWorkflowNode = memo(function SubWorkflowNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('sub_workflow')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('sub_workflow')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={['relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group', 'min-w-[220px]', expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="sub_workflow" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="sub_workflow" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="sub_workflow" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="sub_workflow" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.subWorkflowId && <NodeInfoRow label="workflow" value={nodeData.subWorkflowId} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})