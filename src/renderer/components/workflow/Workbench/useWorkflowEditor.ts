import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react'
import type {
  WorkflowDefinitionV2,
  WorkflowNodeV2,
  WorkflowEdgeV2,
  WorkflowNodeTypeV2,
  WorkflowNodeData,
  WorkflowVariable,
} from '@shared/protocols/workflowV2'
import type { WorkflowDefinition } from '@shared/protocols/workflow'
import { migrateV1ToV2 } from '../shared/migration'
import { createDefaultNode, createDefaultEdge } from '../shared/defaultData'
import { validateWorkflow } from '../shared/validation'
import { applyDagreLayout } from '../Canvas/layout'
import { useUndoRedo } from '../shared/useUndoRedo'
import { saveWorkflowDefinition } from '@shared/configuration/workflows/workflowPersistenceV2'

export interface WorkflowEditorState {
  workflow: WorkflowDefinitionV2 | null
  isModified: boolean
  selectedNodeId: string | null
  rfNodes: Node[]
  rfEdges: Edge[]
  selectedNode: WorkflowNodeV2 | null
  canUndo: boolean
  canRedo: boolean
}

export interface WorkflowEditorActions {
  setWorkflow: React.Dispatch<React.SetStateAction<WorkflowDefinitionV2 | null>>
  setIsModified: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>
  handleNodesChange: (changes: NodeChange[]) => void
  handleEdgesChange: (changes: EdgeChange[]) => void
  handleConnect: (connection: Connection) => void
  handleNodeSelect: (nodeId: string | null) => void
  handleAddNode: (type: WorkflowNodeTypeV2, position?: { x: number; y: number }) => void
  handleAddConnectedNode: (sourceNodeId: string, nodeType: WorkflowNodeTypeV2, sourceHandleId?: string) => void
  handleDeleteNode: (nodeId: string) => void
  handleDuplicateNode: (nodeId: string) => void
  handleDeleteEdge: (edgeId: string) => void
  handleUpdateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void
  handleUpdateNodeName: (nodeId: string, name: string) => void
  handleAutoLayout: () => void
  handleSave: () => void
  handleUndo: () => void
  handleRedo: () => void
  handleSelectWorkflow: (wf: WorkflowDefinitionV2) => void
  handleCreateNew: () => void
}

export function useWorkflowEditor(initialWorkflow?: WorkflowDefinition | WorkflowDefinitionV2 | null) {
  const { fitView } = useReactFlow()

  const [workflow, setWorkflow] = useState<WorkflowDefinitionV2 | null>(() => {
    if (!initialWorkflow) return null
    if ('nodes' in initialWorkflow && 'edges' in initialWorkflow) {
      return initialWorkflow as WorkflowDefinitionV2
    }
    return migrateV1ToV2(initialWorkflow as WorkflowDefinition)
  })

  const [isModified, setIsModified] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { canUndo, canRedo, recordSnapshot, undo, redo } = useUndoRedo(workflow)

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !workflow) return null
    return workflow.nodes.find(n => n.id === selectedNodeId) || null
  }, [selectedNodeId, workflow])

  const rfNodes: Node[] = useMemo(() => {
    const edges = workflow?.edges || []
    return (workflow?.nodes || []).map((n) => {
      const targetEdgeIds = edges.filter(e => e.target === n.id)
      const sourceEdgeIds = edges.filter(e => e.source === n.id)

      const connectedTargetHandleIds = targetEdgeIds
        .map(e => e.targetHandle)
        .filter((h): h is string => !!h)

      const connectedSourceHandleIds = sourceEdgeIds
        .map(e => e.sourceHandle)
        .filter((h): h is string => !!h)

      if (connectedTargetHandleIds.length > 0 && targetEdgeIds.length > connectedTargetHandleIds.length) {
        connectedTargetHandleIds.push('in')
      }
      if (connectedSourceHandleIds.length > 0 && sourceEdgeIds.length > connectedSourceHandleIds.length) {
        connectedSourceHandleIds.push('out')
      }

      return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          label: n.nameZh || n.name,
          nodeType: n.type,
          _connectedTargetHandleIds: connectedTargetHandleIds,
          _connectedSourceHandleIds: connectedSourceHandleIds,
          ...(n.type === 'start' ? { _workflowVariables: workflow?.variables || [] } : {}),
        },
      }
    })
  }, [workflow?.nodes, workflow?.edges])

  const rfEdges: Edge[] = useMemo(
    () =>
      (workflow?.edges || []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
        type: e.type || 'default',
        animated: e.animated,
      })),
    [workflow?.edges],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!workflow) return
      const hasPositionChange = changes.some(c => c.type === 'position' && c.dragging === false)
      const hasRemove = changes.some(c => c.type === 'remove')
      if (hasPositionChange || hasRemove) {
        recordSnapshot(workflow, hasRemove ? 'remove-node' : 'move-node')
      }

      setWorkflow(prev => {
        if (!prev) return prev
        const currentRfNodes: Node[] = prev.nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { nodeType: n.type, label: n.nameZh || n.name },
        }))
        const updatedRfNodes = applyNodeChanges(changes, currentRfNodes)
        const updatedNodes: WorkflowNodeV2[] = prev.nodes.map(wn => {
          const updated = updatedRfNodes.find(rn => rn.id === wn.id)
          return updated ? { ...wn, position: updated.position } : wn
        })
        return { ...prev, nodes: updatedNodes }
      })
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!workflow) return
      const hasRemove = changes.some(c => c.type === 'remove')
      if (hasRemove) {
        recordSnapshot(workflow, 'remove-edge')
      }
      const updatedRfEdges = applyEdgeChanges(changes, rfEdges)
      const updatedEdges: WorkflowEdgeV2[] = updatedRfEdges.map((e) => {
        const edgeData = e as Record<string, unknown>
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || undefined,
          targetHandle: e.targetHandle || undefined,
          label: (edgeData.label as string | undefined) || undefined,
          type: (e.type as WorkflowEdgeV2['type']) || undefined,
          animated: e.animated,
        }
      })
      setWorkflow(prev => prev ? { ...prev, edges: updatedEdges } : prev)
      setIsModified(true)
    },
    [workflow, rfEdges, recordSnapshot],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!workflow || !connection.source || !connection.target) return
      recordSnapshot(workflow, 'add-edge')
      const newEdge = createDefaultEdge(connection.source, connection.target, {
        sourceHandle: connection.sourceHandle || undefined,
        targetHandle: connection.targetHandle || undefined,
      })
      setWorkflow(prev => prev ? { ...prev, edges: [...prev.edges, newEdge] } : prev)
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleAddConnectedNode = useCallback(
    (sourceNodeId: string, nodeType: WorkflowNodeTypeV2, sourceHandleId?: string) => {
      if (!workflow) return
      const sourceNode = workflow.nodes.find(n => n.id === sourceNodeId)
      if (!sourceNode) return

      const nodeCount = workflow.nodes.length
      const sameXNodes = workflow.nodes.filter(
        n => Math.abs(n.position.x - (sourceNode.position.x + 320)) < 50,
      )
      let yOffset = 0
      if (sameXNodes.length > 0 && sameXNodes.length < 6) {
        const maxY = Math.max(...sameXNodes.map(n => n.position.y))
        yOffset = maxY - sourceNode.position.y + 120
      }

      const position = {
        x: sourceNode.position.x + 320,
        y: sourceNode.position.y + yOffset,
      }
      const newNode = createDefaultNode(nodeType, nodeCount, position)
      const newEdge = createDefaultEdge(sourceNodeId, newNode.id, {
        sourceHandle: sourceHandleId || undefined,
      })

      recordSnapshot(workflow, 'add-connected-node')
      setWorkflow(prev =>
        prev
          ? {
              ...prev,
              nodes: [...prev.nodes, newNode],
              edges: [...prev.edges, newEdge],
            }
          : prev,
      )
      setIsModified(true)
      setSelectedNodeId(newNode.id)
    },
    [workflow, recordSnapshot],
  )

  const handleAddNode = useCallback(
    (type: WorkflowNodeTypeV2, position?: { x: number; y: number }) => {
      const nodeCount = workflow?.nodes.length || 0
      let nodePosition = position

      if (!nodePosition && selectedNodeId && workflow) {
        const selectedNode = workflow.nodes.find(n => n.id === selectedNodeId)
        if (selectedNode) {
          const sameXNodes = workflow.nodes.filter(n => Math.abs(n.position.x - (selectedNode.position.x + 320)) < 50)
          let yOffset = 0
          if (sameXNodes.length > 0) {
            const maxY = Math.max(...sameXNodes.map(n => n.position.y))
            yOffset = maxY - selectedNode.position.y + 120
          }
          nodePosition = {
            x: selectedNode.position.x + 320,
            y: selectedNode.position.y + yOffset,
          }
        }
      } else if (!nodePosition) {
        const existingNodes = workflow?.nodes || []
        if (existingNodes.length > 0) {
          const lastNode = existingNodes[existingNodes.length - 1]
          nodePosition = { x: lastNode.position.x + 320, y: lastNode.position.y }
        }
      }

      const newNode = createDefaultNode(type, nodeCount, nodePosition)
      let newEdge: WorkflowEdgeV2 | null = null

      if (!position && workflow) {
        const startNode = workflow.nodes.find(n => n.type === 'start')
        const edgeSourceId = selectedNodeId || (startNode ? startNode.id : null)
        if (edgeSourceId && edgeSourceId !== newNode.id) {
          newEdge = createDefaultEdge(edgeSourceId, newNode.id)
        }
      }

      if (workflow) {
        recordSnapshot(workflow, 'add-node')
        setWorkflow(prev => {
          if (!prev) return prev
          const updated = { ...prev, nodes: [...prev.nodes, newNode] }
          if (newEdge) {
            updated.edges = [...prev.edges, newEdge]
          }
          return updated
        })
      } else {
        setWorkflow({
          id: `wf-${Date.now()}`,
          name: 'New Workflow',
          nameZh: '新工作流',
          description: '',
          descriptionZh: '',
          version: '2.0.0',
          author: '',
          category: 'custom',
          tags: [],
          nodes: [newNode],
          edges: [],
          variables: [],
        })
      }
      setIsModified(true)
      setSelectedNodeId(newNode.id)
    },
    [workflow, recordSnapshot, selectedNodeId],
  )

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      if (!workflow) return
      const node = workflow.nodes.find(n => n.id === nodeId)
      if (!node || node.type === 'start') return
      recordSnapshot(workflow, 'duplicate-node')
      const newNode: WorkflowNodeV2 = {
        ...JSON.parse(JSON.stringify(node)),
        id: `${node.type}-${Date.now()}`,
        name: `${node.name} (copy)`,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
      }
      setWorkflow(prev =>
        prev
          ? { ...prev, nodes: [...prev.nodes, newNode] }
          : prev,
      )
      setSelectedNodeId(newNode.id)
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (!workflow) return
      const node = workflow.nodes.find(n => n.id === nodeId)
      if (node?.type === 'start') return
      recordSnapshot(workflow, 'delete-node')
      setWorkflow(prev =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.filter(n => n.id !== nodeId),
              edges: prev.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
            }
          : prev,
      )
      if (selectedNodeId === nodeId) setSelectedNodeId(null)
      setIsModified(true)
    },
    [workflow, selectedNodeId, recordSnapshot],
  )

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      if (!workflow) return
      recordSnapshot(workflow, 'delete-edge')
      setWorkflow(prev =>
        prev ? { ...prev, edges: prev.edges.filter(e => e.id !== edgeId) } : prev,
      )
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleUpdateNodeData = useCallback(
    (nodeId: string, data: Partial<WorkflowNodeData>) => {
      if (!workflow) return
      recordSnapshot(workflow, 'update-node-data')
      setWorkflow(prev =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
              ),
            }
          : prev,
      )
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleUpdateNodeName = useCallback(
    (nodeId: string, name: string) => {
      if (!workflow) return
      recordSnapshot(workflow, 'rename-node')
      setWorkflow(prev =>
        prev
          ? { ...prev, nodes: prev.nodes.map(n => (n.id === nodeId ? { ...n, name } : n)) }
          : prev,
      )
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleAutoLayout = useCallback(() => {
    if (!workflow) return
    recordSnapshot(workflow, 'auto-layout')
    const layoutedRfNodes = applyDagreLayout(rfNodes, rfEdges)
    const layoutedNodes: WorkflowNodeV2[] = layoutedRfNodes.map((n) => {
      const original = workflow.nodes.find(on => on.id === n.id)
      if (!original) return original!
      return { ...original, position: n.position }
    })
    setWorkflow(prev => prev ? { ...prev, nodes: layoutedNodes } : prev)
    setIsModified(true)
    setTimeout(() => fitView({ padding: 0.2 }), 50)
  }, [workflow, rfNodes, rfEdges, fitView, recordSnapshot])

  const handleSave = useCallback(() => {
    if (!workflow) return
    const result = validateWorkflow(workflow.nodes, workflow.edges)
    if (!result.valid) {
      console.warn('Workflow validation errors:', result.errors)
    }
    saveWorkflowDefinition(workflow)
    setIsModified(false)
  }, [workflow])

  const handleUndo = useCallback(() => {
    setWorkflow(prev => undo(prev))
  }, [undo])

  const handleRedo = useCallback(() => {
    setWorkflow(prev => redo(prev))
  }, [redo])

  const handleSelectWorkflow = useCallback((wf: WorkflowDefinitionV2) => {
    setWorkflow(JSON.parse(JSON.stringify(wf)))
    setSelectedNodeId(null)
    setIsModified(false)
  }, [])

  const handleAddWorkflowVariable = useCallback(
    (variable: { name: string; type: string; defaultValue: unknown; scope: 'workflow' | 'run' }) => {
      if (!workflow) return
      recordSnapshot(workflow, 'add-variable')
      const newVar = {
        name: variable.name,
        type: variable.type as WorkflowVariable['type'],
        defaultValue: variable.defaultValue,
        description: '',
        scope: variable.scope,
      }
      const exists = workflow.variables.some(v => v.name === newVar.name)
      if (exists) return
      setWorkflow(prev =>
        prev
          ? { ...prev, variables: [...prev.variables, newVar] }
          : prev,
      )
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleRemoveWorkflowVariable = useCallback(
    (name: string) => {
      if (!workflow) return
      recordSnapshot(workflow, 'remove-variable')
      setWorkflow(prev =>
        prev
          ? { ...prev, variables: prev.variables.filter(v => v.name !== name) }
          : prev,
      )
      setIsModified(true)
    },
    [workflow, recordSnapshot],
  )

  const handleCreateNew = useCallback(() => {
    const startNode: WorkflowNodeV2 = {
      id: `start-${Date.now()}`,
      type: 'start',
      name: '开始',
      nameZh: '开始',
      position: { x: 80, y: 280 },
      data: {
        welcomeMessage: '欢迎使用工作流，从这里开始构建你的自动化流程',
        welcomeMessageZh: '欢迎使用工作流，从这里开始构建你的自动化流程',
        guideQuestions: [
          { id: 'q-1', text: '帮我写一份项目周报', textZh: '帮我写一份项目周报' },
          { id: 'q-2', text: '分析代码性能问题', textZh: '分析代码性能问题' },
          { id: 'q-3', text: '帮我总结今天的讨论要点', textZh: '帮我总结今天的讨论要点' },
        ],
      },
    }
    const newWf: WorkflowDefinitionV2 = {
      id: `wf-${Date.now()}`,
      name: 'New Workflow',
      nameZh: '新工作流',
      description: '',
      descriptionZh: '',
      version: '2.0.0',
      author: '',
      category: 'custom',
      tags: [],
      nodes: [startNode],
      edges: [],
      variables: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setWorkflow(newWf)
    setSelectedNodeId(null)
    setIsModified(false)
  }, [])

  useEffect(() => {
    const handleAddVar = (e: Event) => {
      handleAddWorkflowVariable((e as CustomEvent).detail)
    }
    const handleRemoveVar = (e: Event) => {
      handleRemoveWorkflowVariable((e as CustomEvent<{ name: string }>).detail.name)
    }
    document.addEventListener('wf-add-workflow-variable', handleAddVar)
    document.addEventListener('wf-remove-workflow-variable', handleRemoveVar)
    return () => {
      document.removeEventListener('wf-add-workflow-variable', handleAddVar)
      document.removeEventListener('wf-remove-workflow-variable', handleRemoveVar)
    }
  }, [handleAddWorkflowVariable, handleRemoveWorkflowVariable])

  useEffect(() => {
    const handler = (e: Event) => {
      const { sourceNodeId, nodeType, sourceHandleId } = (e as CustomEvent<{
        sourceNodeId: string
        nodeType: WorkflowNodeTypeV2
        sourceHandleId?: string
      }>).detail
      handleAddConnectedNode(sourceNodeId, nodeType, sourceHandleId)
    }
    document.addEventListener('wf-add-connected-node', handler)
    return () => document.removeEventListener('wf-add-connected-node', handler)
  }, [handleAddConnectedNode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  return {
    workflow,
    isModified,
    selectedNodeId,
    rfNodes,
    rfEdges,
    selectedNode,
    canUndo,
    canRedo,
    setWorkflow,
    setIsModified,
    setSelectedNodeId,
    handleNodesChange,
    handleEdgesChange,
    handleConnect,
    handleNodeSelect,
    handleAddNode,
    handleAddConnectedNode,
    handleDeleteNode,
    handleDuplicateNode,
    handleDeleteEdge,
    handleUpdateNodeData,
    handleUpdateNodeName,
    handleAutoLayout,
    handleSave,
    handleUndo,
    handleRedo,
    handleSelectWorkflow,
    handleCreateNew,
  }
}
