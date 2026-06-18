/**
 * AgentDevPanel - 多 Agent 协作开发主面板
 *
 * 聚合所有 Agent 协作子组件，提供 Tab 切换导航。
 * 子面板：
 * - 角色选择 (AgentRoleSelector)
 * - 任务看板 (AgentTaskBoard)
 * - 代码审查 (AgentCodeDiffView + AgentReviewThread)
 * - 流水线 (AgentPipelineProgress)
 * - 历史记录 (AgentDevSessionHistory)
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { Users, ListTodo, GitCompare, Workflow, History } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import AgentRoleSelector from './AgentRoleSelector'
import AgentTaskBoard from './AgentTaskBoard'
import AgentCodeDiffView from './AgentCodeDiffView'
import AgentReviewThread from './AgentReviewThread'
import AgentPipelineProgress from './AgentPipelineProgress'
import AgentDevSessionHistory from './AgentDevSessionHistory'
import type { AgentRole } from '../../types'
import type { AgentSessionState } from '../../services/AgentSessionService'

type PanelTab = 'agents' | 'tasks' | 'review' | 'pipeline' | 'history'

const TAB_KEYS: PanelTab[] = ['agents', 'tasks', 'review', 'pipeline', 'history']

const TAB_ICONS: Record<PanelTab, React.ComponentType<{ className?: string }>> = {
  agents: Users,
  tasks: ListTodo,
  review: GitCompare,
  pipeline: Workflow,
  history: History,
}

interface AgentDevPanelProps {
  session?: AgentSessionState | null
  projectId?: string
  projectName?: string
  onCreateSession?: (roles: AgentRole[]) => void
  onPauseSession?: () => void
  onCompleteSession?: () => void
  onSendMessage?: (content: string, to: AgentRole | 'broadcast') => void
}

const AgentDevPanel: React.FC<AgentDevPanelProps> = ({
  session,
  projectId,
  projectName,
  onCreateSession,
  onPauseSession,
  onCompleteSession,
  onSendMessage,
}) => {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<PanelTab>('agents')

  const handleTabChange = useCallback((tab: PanelTab) => {
    setActiveTab(tab)
  }, [])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'agents':
        return (
          <AgentRoleSelector
            session={session}
            onCreateSession={onCreateSession}
            onPauseSession={onPauseSession}
            onCompleteSession={onCompleteSession}
          />
        )
      case 'tasks':
        return (
          <AgentTaskBoard
            session={session}
            projectId={projectId}
            onSendMessage={onSendMessage}
          />
        )
      case 'review':
        return (
          <div className="flex flex-row h-full gap-2 p-2">
            <div className="flex-1 min-w-0">
              <AgentCodeDiffView session={session} />
            </div>
            <div className="w-72 flex-shrink-0">
              <AgentReviewThread session={session} onSendMessage={onSendMessage} />
            </div>
          </div>
        )
      case 'pipeline':
        return <AgentPipelineProgress session={session} />
      case 'history':
        return (
          <AgentDevSessionHistory
            projectId={projectId}
            projectName={projectName}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tab 导航 */}
      <div className="flex items-center border-b border-border bg-muted/30">
        {TAB_KEYS.map(tabId => {
          const Icon = TAB_ICONS[tabId]
          return (
            <button
              key={tabId}
              onClick={() => handleTabChange(tabId)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tabId
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t(`studio.agent.tab.${tabId}`)}</span>
              {tabId === 'tasks' && session && (
                <span className="ml-0.5 px-1 py-0.5 rounded text-[10px] bg-muted">
                  {session.session.tasks.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {renderTabContent()}
      </div>
    </div>
  )
}

export default AgentDevPanel