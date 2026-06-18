/**
 * AgentDevSessionHistory - 开发会话历史记录
 *
 * 展示项目的所有历史会话列表，支持查看会话详情。
 */
import type React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { History, Clock, Users, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { agentSessionService } from '../../services/AgentSessionService'
import type { DevSession } from '../../types'

interface AgentDevSessionHistoryProps {
  projectId?: string
  projectName?: string
}

const AgentDevSessionHistory: React.FC<AgentDevSessionHistoryProps> = ({
  projectId,
  projectName,
}) => {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<DevSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const result = await agentSessionService.getProjectSessions(projectId)
      setSessions(result)
    } catch (err) {
      setError(t('studio.agent.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <History className="w-8 h-8 opacity-30" />
        <p className="text-xs">{t('studio.agent.selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">
            {projectName ? t('studio.agent.sessions', { name: projectName }) : t('studio.agent.history')}
          </span>
        </div>
        <button
          onClick={loadSessions}
          disabled={loading}
          className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-1">
            <p className="text-xs text-red-500">{error}</p>
            <button
              onClick={loadSessions}
              className="text-[10px] text-primary hover:underline"
            >
              {t('studio.agent.retry')}
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-1">
            <History className="w-6 h-6 opacity-30" />
            <p className="text-[10px]">{t('studio.agent.noSessions')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {sessions.map(session => {
              const isExpanded = expandedId === session.id
              return (
                <div key={session.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : session.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
                  >
                    <ChevronRight
                      className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">
                          {session.title ?? t('studio.agent.untitledSession')}
                        </span>
                        <span className={`px-1 py-0.5 rounded text-[8px] font-medium ${
                          session.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : session.status === 'paused'
                            ? 'bg-orange-500/10 text-orange-500'
                            : 'bg-muted/50 text-muted-foreground'
                        }`}>
                          {session.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTime(session.createdAt)}
                        </span>
                        <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                          <Users className="w-2.5 h-2.5" />
                          {t(`studio.agent.mode.${session.mode}`)}
                        </span>
                        {session.tasks.length > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {t('studio.agent.taskCount', { count: session.tasks.length })}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-6 py-2 bg-muted/10 text-[10px] text-muted-foreground space-y-1">
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <span className="text-muted-foreground/60">{t('studio.agent.sessionId')}:</span>{' '}
                          <span className="font-mono">{session.id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/60">{t('studio.agent.sessionMode')}:</span>{' '}
                          <span>{session.mode}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/60">{t('studio.agent.sessionCreated')}:</span>{' '}
                          <span>{formatTime(session.createdAt)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/60">{t('studio.agent.sessionUpdated')}:</span>{' '}
                          <span>{formatTime(session.updatedAt)}</span>
                        </div>
                      </div>
                      {session.tasks.length > 0 && (
                        <div className="mt-1">
                          <span className="text-muted-foreground/60">{t('studio.agent.sessionTasks')}:</span>
                          <div className="mt-0.5 space-y-0.5">
                            {session.tasks.map(task => (
                              <div key={task.id} className="flex items-center gap-1 pl-2 border-l-2 border-border">
                                <span>{task.title}</span>
                                <span className={`text-[8px] px-1 py-0.5 rounded ${
                                  task.status === 'completed'
                                    ? 'bg-emerald-500/10 text-emerald-500'
                                    : task.status === 'in_progress'
                                    ? 'bg-blue-500/10 text-blue-500'
                                    : 'bg-muted/50 text-muted-foreground'
                                }`}>
                                  {task.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentDevSessionHistory