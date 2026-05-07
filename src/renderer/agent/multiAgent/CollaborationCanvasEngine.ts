import { logger } from '@utils/Logger'
import type { Orchestrator, OrchestratorEvent, SessionState } from '../multiAgent/Orchestrator'
import type { AgentInstance, AgentMessage, CollaborationTask } from '@shared/types/multiAgent'

export interface CanvasNode {
  id: string
  type: 'agent' | 'task' | 'message' | 'artifact'
  x: number
  y: number
  width: number
  height: number
  data: AgentNodeData | TaskNodeData | MessageEdgeData | ArtifactNodeData
  status: 'idle' | 'active' | 'completed' | 'error'
  color: string
  visible: boolean
}

export interface AgentNodeData {
  agentId: string
  roleName: string
  roleDescription: string
  messageCount: number
  lastActiveAt: number
}

export interface TaskNodeData {
  taskId: string
  description: string
  assignedTo: string[]
  result?: string
  round?: number
}

export interface MessageEdgeData {
  fromAgentId: string
  toAgentId: string
  messageType: string
  content: string
  timestamp: number
}

export interface ArtifactNodeData {
  name: string
  type: 'code' | 'document' | 'diagram' | 'data'
  content: string
  createdBy: string
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  type: 'communication' | 'task_assignment' | 'dependency' | 'data_flow'
  animated: boolean
  label?: string
  data?: Record<string, unknown>
}

export interface CollaborationLayout {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

type LayoutListener = (layout: CollaborationLayout) => void

const AGENT_COLORS = [
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
]

const PATTERN_LAYOUTS: Record<string, (agentCount: number) => Array<{ x: number; y: number }>> = {
  orchestrator: (count) => {
    const positions = [{ x: 400, y: 200 }]
    for (let i = 1; i < count; i++) {
      const angle = ((i - 1) / (count - 1)) * Math.PI - Math.PI / 2
      positions.push({
        x: 400 + Math.cos(angle) * 250,
        y: 200 + Math.sin(angle) * 200 + 150,
      })
    }
    return positions
  },
  pipeline: (count) => {
    return Array.from({ length: count }, (_, i) => ({
      x: 100 + i * 250,
      y: 250,
    }))
  },
  'peer-to-peer': (count) => {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2
      return {
        x: 400 + Math.cos(angle) * 200,
        y: 300 + Math.sin(angle) * 200,
      }
    })
  },
  debate: (count) => {
    return Array.from({ length: count }, (_, i) => ({
      x: i % 2 === 0 ? 200 : 600,
      y: 150 + Math.floor(i / 2) * 250,
    }))
  },
  review: () => [
    { x: 250, y: 250 },
    { x: 550, y: 250 },
  ],
}

class CollaborationCanvasEngine {
  private layouts = new Map<string, CollaborationLayout>()
  private listeners = new Set<LayoutListener>()
  private unsubFns: Array<() => void> = []
  private orchestrator: Orchestrator | null = null
  private messageHistory: Array<{ sessionId: string; message: AgentMessage }> = []

  connect(orchestrator: Orchestrator): void {
    this.orchestrator = orchestrator

    const unsub = orchestrator.onEvent((event: OrchestratorEvent) => {
      this.handleOrchestratorEvent(event)
    })
    this.unsubFns.push(unsub)

    logger.agent.info('[CollaborationCanvas] Connected to orchestrator')
  }

  disconnect(): void {
    for (const unsub of this.unsubFns) {
      unsub()
    }
    this.unsubFns = []
    this.orchestrator = null
    this.layouts.clear()
    this.listeners.clear()
    this.messageHistory = []
  }

  getLayout(sessionId: string): CollaborationLayout | undefined {
    return this.layouts.get(sessionId)
  }

  getAllLayouts(): Map<string, CollaborationLayout> {
    return this.layouts
  }

  subscribe(listener: LayoutListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  buildLayoutFromSession(session: SessionState): CollaborationLayout {
    const agents = Array.from(session.agents.values())
    const tasks = Array.from(session.tasks.values())
    const messages = session.messageBus.getAllMessages()

    const layoutFn = PATTERN_LAYOUTS[session.config.pattern] || PATTERN_LAYOUTS['peer-to-peer']
    const positions = layoutFn(agents.length)

    const nodes: CanvasNode[] = agents.map((agent, i) => ({
      id: `agent-${agent.id}`,
      type: 'agent' as const,
      x: positions[i]?.x ?? 400,
      y: positions[i]?.y ?? 300,
      width: 180,
      height: 100,
      data: {
        agentId: agent.id,
        roleName: agent.role.name,
        roleDescription: agent.role.description,
        messageCount: agent.messageCount,
        lastActiveAt: agent.lastActiveAt,
      } as AgentNodeData,
      status: agent.status === 'thinking' || agent.status === 'executing' ? 'active' : agent.status === 'error' ? 'error' : agent.status === 'completed' ? 'completed' : 'idle',
      color: AGENT_COLORS[i % AGENT_COLORS.length],
      visible: true,
    }))

    const taskOffsetY = 450
    const taskNodes: CanvasNode[] = tasks.map((task, i) => ({
      id: `task-${task.id}`,
      type: 'task' as const,
      x: 100 + (i % 4) * 250,
      y: taskOffsetY + Math.floor(i / 4) * 120,
      width: 220,
      height: 80,
      data: {
        taskId: task.id,
        description: task.description,
        assignedTo: task.assignedTo,
        result: task.result,
      } as TaskNodeData,
      status: task.status === 'in_progress' ? 'active' : task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'error' : 'idle',
      color: '#6b7280',
      visible: true,
    }))

    const edges: CanvasEdge[] = []

    for (const task of tasks) {
      for (const agentId of task.assignedTo) {
        const agentNodeId = `agent-${agentId}`
        const taskNodeId = `task-${task.id}`
        const agent = agents.find(a => a.id === agentId || a.role.id === agentId)
        if (agent) {
          edges.push({
            id: `edge-${agent.id}-${task.id}`,
            source: `agent-${agent.id}`,
            target: taskNodeId,
            type: 'task_assignment',
            animated: task.status === 'in_progress',
            label: task.status === 'in_progress' ? 'working' : undefined,
          })
        }
      }

      if (task.dependencies) {
        for (const depId of task.dependencies) {
          edges.push({
            id: `edge-dep-${task.id}-${depId}`,
            source: `task-${depId}`,
            target: `task-${task.id}`,
            type: 'dependency',
            animated: false,
          })
        }
      }
    }

    for (const msg of messages) {
      if (msg.to === 'broadcast') continue
      edges.push({
        id: `edge-msg-${msg.id}`,
        source: `agent-${msg.from}`,
        target: `agent-${msg.to}`,
        type: 'communication',
        animated: false,
        label: msg.type,
        data: { messageType: msg.type, timestamp: msg.timestamp },
      })
    }

    const layout: CollaborationLayout = {
      nodes: [...nodes, ...taskNodes],
      edges: this.deduplicateEdges(edges),
    }

    this.layouts.set(session.id, layout)
    this.notifyListeners(session.id, layout)
    return layout
  }

  updateNodePosition(sessionId: string, nodeId: string, x: number, y: number): void {
    const layout = this.layouts.get(sessionId)
    if (!layout) return

    const node = layout.nodes.find(n => n.id === nodeId)
    if (node) {
      node.x = x
      node.y = y
      this.notifyListeners(sessionId, layout)
    }
  }

  getMessageHistory(sessionId: string): AgentMessage[] {
    return this.messageHistory
      .filter(h => h.sessionId === sessionId)
      .map(h => h.message)
  }

  private handleOrchestratorEvent(event: OrchestratorEvent): void {
    if (!this.orchestrator) return

    const session = this.orchestrator.getSession(event.sessionId)
    if (!session) return

    switch (event.type) {
      case 'session:start':
      case 'agent:created':
      case 'agent:status':
      case 'task:assigned':
      case 'task:completed':
      case 'task:failed':
        this.buildLayoutFromSession(session)
        break
      case 'message:sent':
        this.buildLayoutFromSession(session)
        break
      case 'session:end':
        this.buildLayoutFromSession(session)
        break
    }
  }

  private deduplicateEdges(edges: CanvasEdge[]): CanvasEdge[] {
    const seen = new Set<string>()
    return edges.filter(edge => {
      const key = `${edge.source}-${edge.target}-${edge.type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private notifyListeners(sessionId: string, layout: CollaborationLayout): void {
    for (const listener of this.listeners) {
      try {
        listener(layout)
      } catch (e) {
        logger.agent.error('[CollaborationCanvas] Listener error:', e)
      }
    }
  }
}

export const collaborationCanvasEngine = new CollaborationCanvasEngine()
