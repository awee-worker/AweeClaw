import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const VariableSetNode = memo(function VariableSetNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('variable_set')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('variable_set')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="variable_set" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="variable_set" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="variable_set" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="variable_set" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.variableName && <NodeInfoRow label="var" value={nodeData.variableName} color={color} />}
          {nodeData.variableValue && <NodeInfoRow label="value" value={nodeData.variableValue} />}
        </NodeBody>
      )}
    </div>
  )
})

export const DataTransformNode = memo(function DataTransformNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('data_transform')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('data_transform')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="data_transform" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="data_transform" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="data_transform" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="data_transform" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.transformExpression && <NodeInfoRow label="expr" value={nodeData.transformExpression} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const KnowledgeQueryNode = memo(function KnowledgeQueryNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('knowledge_query')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('knowledge_query')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="knowledge_query" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="knowledge_query" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="knowledge_query" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="knowledge_query" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.knowledgeBaseId && <NodeInfoRow label="kb" value={nodeData.knowledgeBaseId} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})