import { useCallback, useMemo, useRef, useState, useEffect, memo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes,
  type IsValidConnection,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypeComponents } from './nodes'
import { edgeTypeComponents } from './edges'
import CustomConnectionLine from './CustomConnectionLine'
import { useNodeScrollGuard } from './nodes/NodeShared'
import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'
import { getOutputHandles, getInputHandles } from '../shared/nodeTypes'

interface FlowCanvasProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  onNodeSelect: (nodeId: string | null) => void
  onNodeDataUpdate: (nodeId: string, data: Record<string, unknown>) => void
  onAddNode: (type: WorkflowNodeTypeV2, position?: { x: number; y: number }) => void
  onDeleteNode: (nodeId: string) => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onInsertNode?: (sourceNodeId: string, targetNodeId: string, position: { x: number; y: number }) => void
}

const typedNodeTypes = nodeTypeComponents as unknown as NodeTypes
const typedEdgeTypes = edgeTypeComponents as unknown as EdgeTypes

const FlowCanvas = memo(function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onAddNode,
  onDeleteNode,
  onDuplicateNode,
  onDeleteEdge,
  onNodeDataUpdate,
}: FlowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [isDragOver, setIsDragOver] = useState(false)
  const hasFitView = useRef(false)

  useNodeScrollGuard()

  useEffect(() => {
    if (nodes.length > 0 && !hasFitView.current) {
      hasFitView.current = true
      const timer = setTimeout(() => {
        fitView({ padding: 0.4, duration: 400, maxZoom: 0.7 })
      }, 120)
      return () => clearTimeout(timer)
    }
  }, [nodes, fitView])

  useEffect(() => {
    const handleDeleteNode = (e: Event) => {
      const nodeId = (e as CustomEvent<string>).detail
      onDeleteNode(nodeId)
    }
    document.addEventListener('wf-delete-node', handleDeleteNode)
    return () => document.removeEventListener('wf-delete-node', handleDeleteNode)
  }, [onDeleteNode])

  useEffect(() => {
    const handleDuplicateNode = (e: Event) => {
      const nodeId = (e as CustomEvent<string>).detail
      onDuplicateNode(nodeId)
    }
    document.addEventListener('wf-duplicate-node', handleDuplicateNode)
    return () => document.removeEventListener('wf-duplicate-node', handleDuplicateNode)
  }, [onDuplicateNode])

  useEffect(() => {
    const handleUpdateNodeData = (e: Event) => {
      const { nodeId, data } = (e as CustomEvent<{ nodeId: string; data: Record<string, unknown> }>).detail
      onNodeDataUpdate(nodeId, data)
    }
    document.addEventListener('wf-update-node-data', handleUpdateNodeData)
    return () => document.removeEventListener('wf-update-node-data', handleUpdateNodeData)
  }, [onNodeDataUpdate])

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => onNodesChange(changes),
    [onNodesChange],
  )

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => onEdgesChange(changes),
    [onEdgesChange],
  )

  const handleConnect: OnConnect = useCallback(
    (connection) => onConnect(connection),
    [onConnect],
  )

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      if (connection.source === connection.target) return false

      const sourceNode = nodeMap.get(connection.source)
      const targetNode = nodeMap.get(connection.target)
      if (!sourceNode || !targetNode) return false

      const sourceType = (sourceNode.data as Record<string, unknown>)?.nodeType as WorkflowNodeTypeV2 | undefined
      const targetType = (targetNode.data as Record<string, unknown>)?.nodeType as WorkflowNodeTypeV2 | undefined
      if (!sourceType || !targetType) return false

      if (connection.sourceHandle) {
        const validOutputs = getOutputHandles(sourceType)
        if (!validOutputs.includes(connection.sourceHandle)) return false
      }

      if (connection.targetHandle) {
        const validInputs = getInputHandles(targetType)
        if (!validInputs.includes(connection.targetHandle)) return false
      }

      const exists = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === (connection.sourceHandle || null),
      )
      return !exists
    },
    [nodeMap, edges],
  )

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => onNodeSelect(node.id),
    [onNodeSelect],
  )

  const handlePaneClick = useCallback(() => onNodeSelect(null), [onNodeSelect])

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault()
      onDeleteEdge(edge.id)
    },
    [onDeleteEdge],
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setIsDragOver(false)

      const nodeType = event.dataTransfer.getData('application/workflow-node-type') as WorkflowNodeTypeV2
      if (!nodeType) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      onAddNode(nodeType, position)
    },
    [screenToFlowPosition, onAddNode],
  )

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'default' as const,
      animated: false,
      data: {},
    }),
    [],
  )

  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        isValidConnection={isValidConnection}
        nodeTypes={typedNodeTypes}
        edgeTypes={typedEdgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineComponent={CustomConnectionLine}
        fitView={false}
        fitViewOptions={{ padding: 0.4, maxZoom: 0.7 }}
        snapToGrid
        snapGrid={[8, 8]}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionRadius={48}
        connectOnClick
        className="bg-gray-50/50"
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
        panOnDrag={true}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        noWheelClassName="no-wheel"
        noDragClassName="nodrag"
        minZoom={0.15}
        maxZoom={2.5}
        elevateEdgesOnSelect
        elevateNodesOnSelect
        autoPanOnConnect
        autoPanOnNodeDrag
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={20}
          size={0.5}
          color="#e2e8f0"
          style={{ opacity: 0.5 }}
        />
        <Controls
          className="!bg-white/90 !backdrop-blur-sm !border !border-gray-200 !shadow-md !rounded-xl !overflow-hidden !p-1"
          position="bottom-right"
        />
      </ReactFlow>

      {isDragOver && (
        <div className="absolute inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="px-8 py-5 rounded-2xl bg-blue-500/10 border-2 border-dashed border-blue-400/40 backdrop-blur-md shadow-[0_8px_32px_rgba(59,130,246,0.08)]">
            <p className="text-sm font-semibold text-blue-500">
              {nodes.length > 0 ? '释放以添加节点' : '拖放节点到画布开始构建工作流'}
            </p>
          </div>
        </div>
      )}

      {nodes.length === 0 && !isDragOver && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100/60 flex items-center justify-center shadow-sm">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-500 mb-1.5">工作流画布为空</p>
            <p className="text-xs text-gray-400 leading-relaxed">从左侧节点面板拖拽节点到画布，或点击节点快速添加，开始构建您的工作流</p>
          </div>
        </div>
      )}
    </div>
  )
})

export default FlowCanvas