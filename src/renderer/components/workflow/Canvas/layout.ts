import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

export function applyDagreLayout(nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB'): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => '')
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 })

  for (const node of nodes) {
    g.setNode(node.id, { width: 220, height: 80 })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const dagreNode = g.node(node.id)
    if (!dagreNode) return node
    return {
      ...node,
      position: {
        x: dagreNode.x - 110,
        y: dagreNode.y - 40,
      },
    }
  })
}
