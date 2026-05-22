import type { WorkflowNodeV2, WorkflowEdgeV2 } from '@shared/protocols/workflowV2'

export function getTopologicalOrder(nodes: WorkflowNodeV2[], edges: WorkflowEdgeV2[]): string[] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, Set<string>>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, new Set())
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId)
  }

  const result: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  return result
}

export function getEntryNodes(nodes: WorkflowNodeV2[], edges: WorkflowEdgeV2[]): WorkflowNodeV2[] {
  const targetIds = new Set(edges.map(e => e.target))
  return nodes.filter(n => !targetIds.has(n.id))
}
