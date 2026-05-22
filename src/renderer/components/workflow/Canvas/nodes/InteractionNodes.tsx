import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, StackedSourceHandles, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const UserInputNode = memo(function UserInputNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('user_input')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('user_input')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])
  const inputType = (nodeData.inputType as string) || 'text'
  const inputLabel = nodeData.inputLabel as string | undefined
  const required = nodeData.required as boolean | undefined
  const inputOptions = nodeData.inputOptions as Array<{ label: string; value: string }> | undefined
  const allowMultipleFiles = nodeData.allowMultipleFiles as boolean | undefined
  const outputVar = nodeData.outputVar as string | undefined

  const typeBadge: Record<string, string> = {
    text: 'T',
    multiline: 'M',
    number: '#',
    select: '≡',
    confirm: '✓',
    file: '📎',
  }

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="user_input" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="user_input" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="user_input" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="user_input" data={nodeData} />
      ) : (
        <NodeBody>
          <div className="flex items-center gap-1.5 text-[10px] min-w-0">
            <span className="w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: `${color}15`, color }}>
              {typeBadge[inputType] || 'T'}
            </span>
            <span className="text-[10px] text-gray-400 flex-shrink-0 font-medium">
              {{
                text: 'Text',
                multiline: 'Multiline',
                number: 'Number',
                select: 'Select',
                confirm: 'Confirm',
                file: 'File',
              }[inputType] || inputType}
            </span>
            {required && (
              <span className="text-[9px] text-red-400 font-medium">*req</span>
            )}
          </div>
          {inputLabel && (
            <NodeInfoRow label="ask" value={inputLabel} color={color} />
          )}
          {inputType === 'select' && inputOptions?.length ? (
            <NodeInfoRow label="opts" value={`${inputOptions.length}`} color={color} />
          ) : null}
          {inputType === 'file' && (
            <div className="flex items-center gap-1 text-[10px] text-gray-400 min-w-0">
              <span className="flex-shrink-0">{allowMultipleFiles ? 'multi' : 'single'}</span>
            </div>
          )}
          {outputVar && <NodeInfoRow label="→ var" value={outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const UserApprovalNode = memo(function UserApprovalNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('user_approval')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('user_approval')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="user_approval" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="user_approval" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="user_approval"
            handles={[
              { handleId: 'approved', connected: nodeData._connectedSourceHandleIds?.includes('approved') || false },
              { handleId: 'rejected', connected: nodeData._connectedSourceHandleIds?.includes('rejected') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="user_approval" data={nodeData} />
      ) : (
        <NodeBody>
          {(nodeData.approverList?.length ?? 0) > 0 && <NodeInfoRow label="approvers" value={`${nodeData.approverList!.length}`} color={color} />}
          {nodeData.approvalTimeout && <NodeInfoRow label="timeout" value={`${nodeData.approvalTimeout / 1000}s`} />}
        </NodeBody>
      )}
    </div>
  )
})

export const FormCollectorNode = memo(function FormCollectorNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('form_collector')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('form_collector')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])
  const fieldCount = (nodeData.formFields as Array<unknown>)?.length || 0

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="form_collector" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="form_collector" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="form_collector" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="form_collector" data={nodeData} />
      ) : (
        <NodeBody>
          {fieldCount > 0 && <NodeInfoRow label="fields" value={`${fieldCount}`} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})