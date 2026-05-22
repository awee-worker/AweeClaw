import type { WorkflowNodeV2, WorkflowEdgeV2 } from '@shared/protocols/workflowV2'

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  nodeId?: string
  edgeId?: string
  message: string
  type: 'missing_connection' | 'cycle' | 'invalid_config' | 'orphan_node' | 'duplicate_id'
}

export interface ValidationWarning {
  nodeId?: string
  message: string
  type: 'no_output' | 'unreachable' | 'no_error_handler' | 'empty_config'
}

export function validateWorkflow(nodes: WorkflowNodeV2[], edges: WorkflowEdgeV2[]): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  const nodeIds = new Set(nodes.map(n => n.id))
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const duplicateIds = nodes.filter((n, i) => nodes.findIndex(x => x.id === n.id) !== i)
  for (const dup of duplicateIds) {
    errors.push({ nodeId: dup.id, type: 'duplicate_id', message: `Duplicate node ID: ${dup.id}` })
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ edgeId: edge.id, type: 'missing_connection', message: `Edge references missing source node: ${edge.source}` })
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ edgeId: edge.id, type: 'missing_connection', message: `Edge references missing target node: ${edge.target}` })
    }
  }

  const nodesWithIncoming = new Set(edges.map(e => e.target))
  const nodesWithOutgoing = new Set(edges.map(e => e.source))

  for (const node of nodes) {
    if (!nodesWithIncoming.has(node.id) && !nodesWithOutgoing.has(node.id)) {
      warnings.push({ nodeId: node.id, type: 'unreachable', message: `Node '${node.name}' is isolated (no connections)` })
    }
  }

  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  const detectCycle = (nodeId: string): void => {
    if (recursionStack.has(nodeId)) {
      errors.push({ nodeId, type: 'cycle', message: `Cycle detected at node '${nodeMap.get(nodeId)?.name || nodeId}'` })
      return
    }
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const outgoingEdges = edges.filter(e => e.source === nodeId)
    for (const edge of outgoingEdges) {
      detectCycle(edge.target)
    }

    recursionStack.delete(nodeId)
  }

  const startNodes = nodes.filter(n => !nodesWithIncoming.has(n.id))
  for (const startNode of startNodes) {
    detectCycle(startNode.id)
  }

  for (const node of nodes) {
    if (!visited.has(node.id) && nodesWithIncoming.has(node.id)) {
      warnings.push({ nodeId: node.id, type: 'unreachable', message: `Node '${node.name}' is unreachable from any start node` })
    }

    if (node.type === 'agent_task' && !node.data.roleId && !node.data.customRole) {
      warnings.push({ nodeId: node.id, type: 'empty_config', message: `Agent task '${node.name}' has no role configured` })
    }

    if (node.type === 'tool_call' && !node.data.toolName) {
      warnings.push({ nodeId: node.id, type: 'empty_config', message: `Tool call '${node.name}' has no tool selected` })
    }

    if (node.type === 'mcp_service' && (!node.data.mcpServerId || !node.data.mcpToolName)) {
      warnings.push({ nodeId: node.id, type: 'empty_config', message: `MCP service '${node.name}' is not fully configured` })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
