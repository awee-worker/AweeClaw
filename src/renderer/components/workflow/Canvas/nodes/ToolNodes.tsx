import { memo, useCallback } from 'react'
import type { WorkflowNodeProps } from './index'
import type { NodeData } from './NodeShared'
import { getNodeColor, getNodeLabel, NodeBody, NodeInfoRow, NodeControlBar, HeaderTargetHandle, SourceHandleWithPicker, StackedSourceHandles, NodeHeader, toggleNodeExpand, emitUpdate } from './NodeShared'
import { NodeInlineEditor } from './NodeInlineEditor'

const expandBaseClass = 'relative rounded-2xl border bg-white shadow-sm transition-all duration-200 group min-w-[220px]'

export const ToolCallNode = memo(function ToolCallNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('tool_call')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('tool_call')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="tool_call" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="tool_call" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="tool_call" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="tool_call" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.toolName && <NodeInfoRow label="tool" value={nodeData.toolName} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const McpServiceNode = memo(function McpServiceNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('mcp_service')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('mcp_service')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="mcp_service" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="mcp_service" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={<SourceHandleWithPicker nodeId={id} nodeType="mcp_service" handleId="out" connected={nodeData._connectedSourceHandleIds?.includes('out') || false} />}
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="mcp_service" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.mcpServerId && <NodeInfoRow label="server" value={nodeData.mcpServerId} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const CodeRunnerNode = memo(function CodeRunnerNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('code_runner')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('code_runner')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="code_runner" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="code_runner" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="code_runner"
            handles={[
              { handleId: 'out', connected: nodeData._connectedSourceHandleIds?.includes('out') || false },
              { handleId: 'error', connected: nodeData._connectedSourceHandleIds?.includes('error') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="code_runner" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.codeLanguage && <NodeInfoRow label="lang" value={nodeData.codeLanguage} color={color} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})

export const HttpRequestNode = memo(function HttpRequestNode({ id, data, selected }: WorkflowNodeProps) {
  const nodeData = data as NodeData
  const color = getNodeColor('http_request')
  const label = (nodeData._customLabel as string) || nodeData.label || getNodeLabel('http_request')
  const expanded = !!nodeData._expanded
  const handleToggleExpand = useCallback(() => toggleNodeExpand(id, !!nodeData._expanded), [id, nodeData._expanded])
  const handleRename = useCallback((newName: string) => { emitUpdate(id, { _customLabel: newName }) }, [id])

  return (
    <div
      className={[expandBaseClass, expanded ? 'max-w-[400px]' : 'max-w-[260px]', selected ? 'shadow-md' : 'hover:shadow-md'].join(' ')}
      style={{ borderColor: selected ? color : '#e5e7eb', boxShadow: selected ? `0 0 0 3px ${color}18` : undefined }}
    >
      <NodeControlBar nodeId={id} />
      <NodeHeader nodeType="http_request" label={label} color={color} selected={!!selected} expanded={expanded} onToggleExpand={handleToggleExpand} onRename={handleRename}
        targetHandle={<HeaderTargetHandle id="in" nodeType="http_request" connected={nodeData._connectedTargetHandleIds?.includes('in') || false} />}
        sourceHandle={
          <StackedSourceHandles nodeId={id} nodeType="http_request"
            handles={[
              { handleId: 'out', connected: nodeData._connectedSourceHandleIds?.includes('out') || false },
              { handleId: 'error', connected: nodeData._connectedSourceHandleIds?.includes('error') || false },
            ]}
          />
        }
      />
      {expanded ? (
        <NodeInlineEditor nodeId={id} nodeType="http_request" data={nodeData} />
      ) : (
        <NodeBody>
          {nodeData.httpMethod && <NodeInfoRow label="method" value={nodeData.httpMethod} color={color} />}
          {nodeData.httpUrl && <NodeInfoRow label="url" value={nodeData.httpUrl} />}
          {nodeData.outputVar && <NodeInfoRow label="output" value={nodeData.outputVar} />}
        </NodeBody>
      )}
    </div>
  )
})