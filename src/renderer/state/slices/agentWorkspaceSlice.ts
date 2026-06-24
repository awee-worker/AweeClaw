import { StateCreator } from 'zustand'

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  timestamp: number
}

export interface AgentProgressEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text_output' | 'error'
  content: string
  toolName?: string
  timestamp: number
}

export interface TeamChatMessage {
  id: string
  fromAgentId: string
  fromAgentName: string
  toAgentId?: string
  type: 'discuss' | 'delegate' | 'handoff' | 'vote' | 'announce' | 'question'
  content: string
  attachments?: string[]
  timestamp: number
}

export interface WorkspaceAgent {
  id: string
  name: string
  icon: string
  role: 'pm' | 'architect' | 'frontend' | 'backend' | 'designer' | 'tester' | 'devops' | 'analyst' | 'custom'
  status: 'waiting' | 'working' | 'completed' | 'failed' | 'moving'
  taskDescription: string
  scope: string
  forbidden: string
  outputFiles: string[]
  startedAt?: number
  completedAt?: number
  errorMessage?: string
  progress: number
  currentStep: string
  toolCalls: AgentToolCall[]
  progressEvents: AgentProgressEvent[]
  outputPreview: string
  iterationCount: number
  retryCount: number
  deskPosition?: { x: number; y: number }
  isMoving?: boolean
  moveTarget?: string
}

export interface AgentWorkspaceSession {
  sessionId: string
  threadId: string
  status: 'planning' | 'plan_review' | 'discussing' | 'executing' | 'completed' | 'failed'
  summary: string
  agents: WorkspaceAgent[]
  currentAgentId?: string
  projectPath?: string
  projectName?: string
  createdAt: number
  plan?: {
    agents: Array<{
      id: string
      name: string
      icon: string
      taskDescription: string
      scope: string
      forbidden: string
    }>
    executionOrder: string[][]
    summary: string
  }
  teamChat: TeamChatMessage[]
  collaborationPhase?: string
  totalDuration?: number
}

export interface AgentWorkspaceSlice {
  activeWorkspaceSession: AgentWorkspaceSession | null
  workspaceViewVisible: boolean
  teamModeEnabled: boolean
  /** 自由模式：自动批准所有工具调用，达到最大思考次数自动继续，全流程无人工干预 */
  freeModeEnabled: boolean

  setActiveWorkspaceSession: (session: AgentWorkspaceSession | null) => void
  updateWorkspaceSession: (updates: Partial<AgentWorkspaceSession>) => void
  updateWorkspaceAgent: (agentId: string, updates: Partial<WorkspaceAgent>) => void
  addAgentProgressEvent: (agentId: string, event: AgentProgressEvent) => void
  addAgentToolCall: (agentId: string, toolCall: AgentToolCall) => void
  updateAgentToolCall: (agentId: string, toolCallId: string, updates: Partial<AgentToolCall>) => void
  addTeamChatMessage: (message: TeamChatMessage) => void
  setWorkspaceViewVisible: (visible: boolean) => void
  setTeamModeEnabled: (enabled: boolean) => void
  setFreeModeEnabled: (enabled: boolean) => void
  clearWorkspaceSession: () => void
  replanWorkspace: () => void
}

export const createAgentWorkspaceSlice: StateCreator<AgentWorkspaceSlice, [], [], AgentWorkspaceSlice> = (set) => ({
  activeWorkspaceSession: null,
  workspaceViewVisible: false,
  teamModeEnabled: false,
  freeModeEnabled: false,

  setActiveWorkspaceSession: (session) => set({ activeWorkspaceSession: session }),

  updateWorkspaceSession: (updates) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, ...updates },
    }
  }),

  updateWorkspaceAgent: (agentId, updates) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    const agents = state.activeWorkspaceSession.agents.map(a =>
      a.id === agentId ? { ...a, ...updates } : a
    )
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, agents },
    }
  }),

  addAgentProgressEvent: (agentId, event) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    const MAX_EVENTS = 200
    const agents = state.activeWorkspaceSession.agents.map(a => {
      if (a.id !== agentId) return a
      const events = [...a.progressEvents, event].slice(-MAX_EVENTS)
      return { ...a, progressEvents: events }
    })
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, agents },
    }
  }),

  addAgentToolCall: (agentId, toolCall) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    const agents = state.activeWorkspaceSession.agents.map(a => {
      if (a.id !== agentId) return a
      return { ...a, toolCalls: [...a.toolCalls, toolCall] }
    })
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, agents },
    }
  }),

  updateAgentToolCall: (agentId, toolCallId, updates) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    const agents = state.activeWorkspaceSession.agents.map(a => {
      if (a.id !== agentId) return a
      const toolCalls = a.toolCalls.map(tc =>
        tc.id === toolCallId ? { ...tc, ...updates } : tc
      )
      return { ...a, toolCalls }
    })
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, agents },
    }
  }),

  addTeamChatMessage: (message) => set((state) => {
    if (!state.activeWorkspaceSession) return state
    const MAX_MESSAGES = 500
    const teamChat = [...state.activeWorkspaceSession.teamChat, message].slice(-MAX_MESSAGES)
    return {
      activeWorkspaceSession: { ...state.activeWorkspaceSession, teamChat },
    }
  }),

  setWorkspaceViewVisible: (visible) => set({ workspaceViewVisible: visible }),

  setTeamModeEnabled: (enabled) => set({ teamModeEnabled: enabled }),

  setFreeModeEnabled: (enabled) => set({ freeModeEnabled: enabled }),

  clearWorkspaceSession: () => set({ activeWorkspaceSession: null, workspaceViewVisible: false }),

  replanWorkspace: () => set((state) => {
    if (!state.activeWorkspaceSession) return state
    return {
      activeWorkspaceSession: {
        ...state.activeWorkspaceSession,
        status: 'planning',
        agents: [],
        plan: undefined,
        summary: '',
        teamChat: [],
        collaborationPhase: undefined,
        totalDuration: undefined,
      },
    }
  }),
})
