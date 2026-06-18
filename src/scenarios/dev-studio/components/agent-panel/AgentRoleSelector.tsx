/**
 * AgentRoleSelector - Agent 角色选择器
 *
 * 显示可用的 Agent 角色，支持选择/取消选择，展示角色详情。
 * 无会话时显示创建会话入口，有会话时展示 Agent 状态面板。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import {
  UserCheck, Code2, Search, FlaskConical, Cloud,
  Play, Pause, Square, Loader2, Brain, Zap, MessageSquare,
} from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { agentSessionService } from '../../services/AgentSessionService'
import type { AgentRole } from '../../types'
import type { AgentSessionState } from '../../services/AgentSessionService'

interface AgentRoleSelectorProps {
  session?: AgentSessionState | null
  onCreateSession?: (roles: AgentRole[]) => void
  onPauseSession?: () => void
  onCompleteSession?: () => void
}

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pm: UserCheck,
  coder: Code2,
  reviewer: Search,
  tester: FlaskConical,
  devops: Cloud,
}

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  idle: Brain,
  thinking: Loader2,
  executing: Zap,
  waiting: Loader2,
  completed: Play,
  error: Square,
}

const AgentRoleSelector: React.FC<AgentRoleSelectorProps> = ({
  session,
  onCreateSession,
  onPauseSession,
  onCompleteSession,
}) => {
  const { t } = useI18n()
  const [selectedRoles, setSelectedRoles] = useState<Set<AgentRole>>(new Set())
  const [creating, setCreating] = useState(false)

  const availableRoles = agentSessionService.getAvailableRoles()

  const toggleRole = useCallback((role: AgentRole) => {
    setSelectedRoles(prev => {
      const next = new Set(prev)
      if (next.has(role)) {
        next.delete(role)
      } else {
        next.add(role)
      }
      return next
    })
  }, [])

  const handleCreate = useCallback(async () => {
    if (selectedRoles.size === 0) return
    setCreating(true)
    try {
      onCreateSession?.(Array.from(selectedRoles))
    } finally {
      setCreating(false)
    }
  }, [selectedRoles, onCreateSession])

  // 有活跃会话时显示 Agent 状态面板
  if (session) {
    return (
      <div className="flex flex-col h-full">
        {/* 会话控制栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium">{t('studio.agent.sessionActive')}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onPauseSession}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title={t('studio.agent.pause')}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCompleteSession}
              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
              title={t('studio.agent.complete')}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Agent 状态列表 */}
        <div className="flex-1 overflow-auto p-2 space-y-1.5">
          {session.agents.map(agent => {
            const roleDef = agentSessionService.getRoleDefinition(agent.role)
            const StatusIcon = STATUS_ICONS[agent.status] ?? Brain
            const statusText = t(`studio.agent.${agent.status}`)
            return (
              <div
                key={agent.role}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className={`w-7 h-7 rounded-md flex items-center justify-center ${roleDef?.color ?? 'bg-muted'}`}>
                  {(() => {
                    const Icon = ROLE_ICONS[agent.role] ?? Brain
                    return <Icon className="w-3.5 h-3.5" />
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">
                    {roleDef?.name ?? agent.role}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <StatusIcon className={`w-3 h-3 ${agent.status === 'executing' ? 'animate-spin' : ''}`} />
                    <span>{statusText}</span>
                    <span className="mx-0.5">·</span>
                    <MessageSquare className="w-2.5 h-2.5" />
                    <span>{agent.messageCount}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // 无活跃会话时显示角色选择界面
  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground">{t('studio.agent.selectRoles')}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {t('studio.agent.selectRolesHint')}
        </p>
      </div>

      {/* 角色列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {availableRoles.map(role => {
          const Icon = ROLE_ICONS[role.id] ?? Brain
          const isSelected = selectedRoles.has(role.id)

          return (
            <div key={role.id}>
              <button
                onClick={() => toggleRole(role.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-all ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                }`}
              >
                <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${role.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{role.name}</div>
                  <div className="text-[10px] text-muted-foreground">{role.nameZh}</div>
                </div>
                <div
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                  }`}
                >
                  {isSelected && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {/* 创建按钮 */}
      <div className="p-2 border-t border-border">
        <button
          onClick={handleCreate}
          disabled={selectedRoles.size === 0 || creating}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {creating ? t('studio.agent.creatingSession') : `${t('studio.agent.startSession')} (${selectedRoles.size})`}
        </button>
      </div>
    </div>
  )
}

export default AgentRoleSelector