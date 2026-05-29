import { logger } from '@toolkit/LogEngine'
import type { TeamChatMessage } from '@renderer/state/slices/agentWorkspaceSlice'

export type CollaborationPhase =
  | 'meeting'
  | 'discussion'
  | 'voting'
  | 'delegation'
  | 'execution'
  | 'handoff'
  | 'review'
  | 'completed'

export interface DiscussionTopic {
  id: string
  title: string
  proposer: string
  content: string
  replies: Array<{
    fromAgentId: string
    fromAgentName: string
    content: string
    timestamp: number
  }>
  status: 'open' | 'resolved' | 'dropped'
}

export interface VoteItem {
  id: string
  topic: string
  options: Array<{
    label: string
    description: string
    voters: string[]
  }>
  status: 'voting' | 'approved' | 'rejected'
  result?: string
}

export interface TaskHandoff {
  id: string
  fromAgentId: string
  fromAgentName: string
  toAgentId: string
  toAgentName: string
  content: string
  attachments: string[]
  status: 'pending' | 'accepted' | 'rejected'
  timestamp: number
}

export interface CollaborationState {
  phase: CollaborationPhase
  meetingSummary: string
  discussionTopics: DiscussionTopic[]
  activeVotes: VoteItem[]
  handoffs: TaskHandoff[]
  phaseHistory: Array<{
    phase: CollaborationPhase
    enteredAt: number
    exitedAt?: number
  }>
}

const PHASE_ORDER: CollaborationPhase[] = [
  'meeting',
  'discussion',
  'voting',
  'delegation',
  'execution',
  'handoff',
  'review',
  'completed',
]

const PHASE_LABELS: Record<CollaborationPhase, string> = {
  meeting: '团队会议',
  discussion: '方案讨论',
  voting: '方案投票',
  delegation: '任务分配',
  execution: '协作执行',
  handoff: '工作交接',
  review: '成果评审',
  completed: '协作完成',
}

export class TeamCollaborationProtocol {
  private state: CollaborationState
  private onStateChange: (state: CollaborationState) => void
  private onChatMessage: (message: TeamChatMessage) => void
  private callLLM: (systemPrompt: string, userMessage: string) => Promise<string>
  private userLanguage: string

  constructor(options: {
    onStateChange: (state: CollaborationState) => void
    onChatMessage: (message: TeamChatMessage) => void
    callLLM: (systemPrompt: string, userMessage: string) => Promise<string>
    userLanguage?: string
  }) {
    this.onStateChange = options.onStateChange
    this.onChatMessage = options.onChatMessage
    this.callLLM = options.callLLM
    this.userLanguage = options.userLanguage || 'zh'
    this.state = {
      phase: 'meeting',
      meetingSummary: '',
      discussionTopics: [],
      activeVotes: [],
      handoffs: [],
      phaseHistory: [{ phase: 'meeting', enteredAt: Date.now() }],
    }
  }

  getState(): CollaborationState {
    return { ...this.state }
  }

  getCurrentPhase(): CollaborationPhase {
    return this.state.phase
  }

  private emitStateChange(): void {
    this.onStateChange({ ...this.state })
  }

  private getLangDirective(): string {
    if (this.userLanguage === 'zh') {
      return '你必须使用中文进行所有交流和输出，不要使用英文。'
    }
    return 'You MUST use English for all communication and output.'
  }

  private emitChat(msg: Omit<TeamChatMessage, 'id' | 'timestamp'>): void {
    this.onChatMessage({
      id: `collab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...msg,
    })
  }

  private transitionTo(phase: CollaborationPhase): void {
    const current = this.state.phaseHistory[this.state.phaseHistory.length - 1]
    if (current && !current.exitedAt) {
      current.exitedAt = Date.now()
    }

    this.state.phase = phase
    this.state.phaseHistory.push({ phase, enteredAt: Date.now() })

    logger.agent.info(`[TeamCollaboration] Phase transition: ${PHASE_LABELS[phase]}`)
    this.emitStateChange()
  }

  async startMeeting(task: string, agents: Array<{ id: string; name: string; role: string }>): Promise<void> {
    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: `📋 团队会议开始！任务：${task}`,
    })

    const pm = agents.find(a => a.role === 'pm') || agents[0]

    this.emitChat({
      fromAgentId: pm.id,
      fromAgentName: pm.name,
      type: 'announce',
      content: `大家好！我们收到一个新任务，让我先分析一下需求，然后我们一起讨论方案。`,
    })

    try {
      const analysisPrompt = `${this.getLangDirective()}\n\n你是一个项目经理，正在主持团队会议。请简要分析以下任务，列出关键要点和可能的挑战：\n\n任务：${task}\n\n团队成员：${agents.map(a => `${a.name}(${a.role})`).join('、')}\n\n请用简洁的要点形式回答，不超过200字。`

      const analysis = await this.callLLM(analysisPrompt, task)

      this.emitChat({
        fromAgentId: pm.id,
        fromAgentName: pm.name,
        type: 'announce',
        content: `我的分析：${analysis.slice(0, 300)}`,
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'Aborted by user') throw err
      logger.agent.warn('[TeamCollaboration] Meeting analysis failed:', err)
    }

    this.state.meetingSummary = task
    this.emitStateChange()
  }

  async startDiscussion(agents: Array<{ id: string; name: string; role: string }>, task: string): Promise<void> {
    this.transitionTo('discussion')

    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: '💬 进入方案讨论阶段，各成员发表意见',
    })

    const rolePerspectives: Record<string, string> = {
      pm: '从项目管理和需求角度',
      architect: '从架构设计和技术选型角度',
      frontend: '从前端实现和用户体验角度',
      backend: '从后端逻辑和数据处理角度',
      designer: '从视觉设计和交互体验角度',
      tester: '从质量保证和测试覆盖角度',
      devops: '从部署运维和基础设施角度',
      analyst: '从数据分析和业务逻辑角度',
    }

    for (const agent of agents.slice(0, 4)) {
      const perspective = rolePerspectives[agent.role] || '从专业角度'
      this.emitChat({
        fromAgentId: agent.id,
        fromAgentName: agent.name,
        type: 'discuss',
        content: `${perspective}来看，我认为我们应该...`,
      })

      try {
        const discussPrompt = `${this.getLangDirective()}\n\n你是${agent.name}，${perspective}的专家。团队任务：${task}\n\n请简要发表你的专业意见（50字以内），只说核心观点。`
        const opinion = await this.callLLM(discussPrompt, task)

        this.emitChat({
          fromAgentId: agent.id,
          fromAgentName: agent.name,
          type: 'discuss',
          content: opinion.slice(0, 150),
        })
      } catch (err) {
        if (err instanceof Error && err.message === 'Aborted by user') throw err
      }
    }

    const topicId = `topic-${Date.now()}`
    this.state.discussionTopics.push({
      id: topicId,
      title: '任务方案讨论',
      proposer: 'system',
      content: task,
      replies: [],
      status: 'resolved',
    })

    this.emitStateChange()
  }

  async startVoting(agents: Array<{ id: string; name: string }>, options: string[]): Promise<VoteItem> {
    this.transitionTo('voting')

    const voteId = `vote-${Date.now()}`
    const voteItem: VoteItem = {
      id: voteId,
      topic: '执行方案',
      options: options.map(opt => ({
        label: opt,
        description: '',
        voters: [],
      })),
      status: 'voting',
    }

    this.state.activeVotes.push(voteItem)
    this.emitStateChange()

    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'vote',
      content: `🗳️ 投票开始：${options.join(' vs ')}`,
    })

    for (const agent of agents) {
      const chosenIdx = Math.floor(Math.random() * options.length)
      voteItem.options[chosenIdx].voters.push(agent.id)

      this.emitChat({
        fromAgentId: agent.id,
        fromAgentName: agent.name,
        type: 'vote',
        content: `我投票给：${options[chosenIdx]}`,
      })
    }

    const maxVotes = Math.max(...voteItem.options.map(o => o.voters.length))
    const winner = voteItem.options.find(o => o.voters.length === maxVotes)

    if (winner) {
      voteItem.status = 'approved'
      voteItem.result = winner.label

      this.emitChat({
        fromAgentId: 'system',
        fromAgentName: '系统',
        type: 'announce',
        content: `✅ 投票结果：${winner.label}（${winner.voters.length}票赞成）`,
      })
    }

    this.emitStateChange()
    return voteItem
  }

  delegateTasks(assignments: Array<{ agentId: string; agentName: string; task: string }>): void {
    this.transitionTo('delegation')

    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: '📋 任务分配完成，各成员开始执行',
    })

    for (const assignment of assignments) {
      this.emitChat({
        fromAgentId: 'system',
        fromAgentName: '系统',
        type: 'delegate',
        toAgentId: assignment.agentId,
        content: `你的任务是：${assignment.task}`,
      })

      this.emitChat({
        fromAgentId: assignment.agentId,
        fromAgentName: assignment.agentName,
        type: 'announce',
        content: `收到！开始执行：${assignment.task.slice(0, 80)}`,
      })
    }

    this.emitStateChange()
  }

  startExecution(): void {
    this.transitionTo('execution')
    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: '🚀 团队开始协作执行！',
    })
  }

  createHandoff(
    fromAgentId: string,
    fromAgentName: string,
    toAgentId: string,
    toAgentName: string,
    content: string,
    attachments: string[] = []
  ): TaskHandoff {
    const handoff: TaskHandoff = {
      id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromAgentId,
      fromAgentName,
      toAgentId,
      toAgentName,
      content,
      attachments,
      status: 'pending',
      timestamp: Date.now(),
    }

    this.state.handoffs.push(handoff)

    this.emitChat({
      fromAgentId,
      fromAgentName,
      toAgentId,
      type: 'handoff',
      content: `📎 工作交接：${content}`,
      attachments,
    })

    this.emitStateChange()
    return handoff
  }

  acceptHandoff(handoffId: string): void {
    const handoff = this.state.handoffs.find(h => h.id === handoffId)
    if (!handoff) return

    handoff.status = 'accepted'

    this.emitChat({
      fromAgentId: handoff.toAgentId,
      fromAgentName: handoff.toAgentName,
      toAgentId: handoff.fromAgentId,
      type: 'handoff',
      content: `✅ 已收到交接，开始处理`,
    })

    this.emitStateChange()
  }

  startReview(): void {
    this.transitionTo('review')

    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: '🔍 进入成果评审阶段',
    })
  }

  complete(): void {
    this.transitionTo('completed')

    this.emitChat({
      fromAgentId: 'system',
      fromAgentName: '系统',
      type: 'announce',
      content: '🎉 团队协作任务全部完成！',
    })
  }

  getPhaseIndex(phase: CollaborationPhase): number {
    return PHASE_ORDER.indexOf(phase)
  }

  getPhaseLabel(phase: CollaborationPhase): string {
    return PHASE_LABELS[phase]
  }

  getPhaseProgress(): number {
    const currentIdx = this.getPhaseIndex(this.state.phase)
    return Math.round((currentIdx / (PHASE_ORDER.length - 1)) * 100)
  }

  getNextPhase(): CollaborationPhase | null {
    const currentIdx = this.getPhaseIndex(this.state.phase)
    return currentIdx < PHASE_ORDER.length - 1 ? PHASE_ORDER[currentIdx + 1] : null
  }
}

export const PHASE_ORDER_LIST = PHASE_ORDER
export const PHASE_LABEL_MAP = PHASE_LABELS
