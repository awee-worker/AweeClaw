import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, StackedSourceHandles, ENHANCED_HANDLE_HOVER, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const ConditionNode = memo(function ConditionNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('condition')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('condition')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])
  const condCount = (nodeData.conditions as Array<unknown>)?.length || 0

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="condition" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="condition" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="condition"
            handles={[
              { handleId: 'true', connected: nodeData._connectedSourceHandleIds?.includes('true') || false },
              { handleId: 'false', connected: nodeData._connectedSourceHandleIds?.includes('false') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="condition" data={nodeData} />
      ) : (
        <NodeBody>
          {condCount > 0 && <NodeInfoRow label="conditions" value={`${condCount}`} color={color} />}
        </NodeBody>
      )}
    </div>
  )
})

export const SwitchCaseNode = memo(function SwitchCaseNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('switch_case')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('switch_case')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])
  const caseCount = (nodeData.switchCases as Array<unknown>)?.length || 0

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="switch_case" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="switch_case" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <div className="absolute flex flex-col z-20" style={{ right: -(ENHANCED_HANDLE_HOVER / 2 + 3), top: '50%', transform: 'translateY(-50%)', gap: 4 }}>
            {nodeData._connectedSourceHandleIds?.filter(h => h !== 'default').map((handleId) => (
              <SourceHandleWithPicker key={handleId} nodeId={id} nodeType="switch_case" handleId={handleId} connected={true} />
            ))}
            <SourceHandleWithPicker nodeId={id} nodeType="switch_case" handleId="default" connected={nodeData._connectedSourceHandleIds?.includes('default') || false} />
          </div>
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="switch_case" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.switchVariable && <NodeInfoRow label="variable" value={nodeData.switchVariable} color={color} />}
          {caseCount > 0 && <NodeInfoRow label="cases" value={`${caseCount}`} />}
        </NodeBody>
      )}
    </div>
  )
})

export const LoopNode = memo(function LoopNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('loop')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('loop')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="loop" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="loop" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="loop"
            handles={[
              { handleId: 'loop_body', connected: nodeData._connectedSourceHandleIds?.includes('loop_body') || false },
              { handleId: 'out', connected: nodeData._connectedSourceHandleIds?.includes('out') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="loop" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.loopType && <NodeInfoRow label="type" value={nodeData.loopType} color={color} />}
          {nodeData.loopMaxIterations && <NodeInfoRow label="max" value={`${nodeData.loopMaxIterations}`} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const ParallelNode = memo(function ParallelNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('parallel')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('parallel')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])
  const branchCount = (nodeData.branches as Array<unknown>)?.length || 0

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="parallel" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="parallel" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <div className="absolute flex flex-col z-20" style={{ right: -(ENHANCED_HANDLE_HOVER / 2 + 3), top: '50%', transform: 'translateY(-50%)', gap: 4 }}>
            {nodeData._connectedSourceHandleIds?.filter(h => h !== 'out').map((handleId) => (
              <SourceHandleWithPicker key={handleId} nodeId={id} nodeType="parallel" handleId={handleId} connected={true} />
            ))}
            <SourceHandleWithPicker nodeId={id} nodeType="parallel" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />
          </div>
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="parallel" data={nodeData} />
      ) : (
        <NodeBody>
          {branchCount > 0 && <NodeInfoRow label="branches" value={`${branchCount}`} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const MergeNode = memo(function MergeNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('merge')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('merge')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="merge" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="merge" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="merge" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="merge" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.mergeStrategy && <NodeInfoRow label="strategy" value={nodeData.mergeStrategy} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})