/**
 * Agent 协作面板
 * 集成后端 Agent Registry API，支持 Agent 选择、团队配置、协作状态监控
 */
import { memo, useState, useCallback, useEffect, useRef } from 'react'
import {
  Bot,
  Users,
  Play,
  Square,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Settings,
  RefreshCw,
  Zap,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getServerUrl, getAccessToken, tryRefreshToken } from '@renderer/adapters/backendApi'

interface AgentInfo {
  id: string
  name: string
  displayName: string | null
  description: string | null
  role: string
  provider: string
  model: string
  capabilities: string[]
  status: string
}

interface CollaborationSession {
  sessionId: string
  agents: AgentInfo[]
  status: 'idle' | 'running' | 'completed' | 'error'
  task: string
  messages: { agentId: string; agentName: string; content: string; type: string }[]
  events: string[]
}

const ROLE_COLORS: Record<string, string> = {
  coordinator: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  analyst: 'bg-purple-400/10 text-purple-400 border-purple-400/30',
  executor: 'bg-green-400/10 text-green-400 border-green-400/30',
  reviewer: 'bg-amber-400/10 text-amber-400 border-amber-400/30',
  specialist: 'bg-rose-400/10 text-rose-400 border-rose-400/30',
  custom: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
}

const ROLE_LABELS: Record<string, string> = {
  coordinator: '协调者',
  analyst: '分析师',
  executor: '执行者',
  reviewer: '审查者',
  specialist: '专家',
  custom: '自定义',
}

interface AgentCollaborationPanelProps {
  className?: string
  onSendMessage?: (message: string, agents: AgentInfo[]) => void
}

export const AgentCollaborationPanel = memo(function AgentCollaborationPanel({
  className = '',
  onSendMessage,
}: AgentCollaborationPanelProps) {
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([])
  const [selectedAgents, setSelectedAgents] = useState<AgentInfo[]>([])
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const [task, setTask] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // HTTP 请求工具
  async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const url = `${getServerUrl()}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const token = getAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    let res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

    if (res.status === 401) {
      const refreshed = await tryRefreshToken()
      if (refreshed) {
        const newToken = getAccessToken()
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`
          res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
        }
      }
    }

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`)
    }

    const json = await res.json()
    return json.data || json
  }

  // 加载可用 Agent
  const loadAgents = useCallback(async () => {
    try {
      setLoading(true)
      const result = await request<AgentInfo[]>('/api/v1/agents')
      setAvailableAgents(result)
      setError(null)
    } catch (err) {
      setError('加载 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages])

  const toggleAgent = useCallback((agent: AgentInfo) => {
    setSelectedAgents((prev) =>
      prev.find((a) => a.id === agent.id)
        ? prev.filter((a) => a.id !== agent.id)
        : [...prev, agent]
    )
  }, [])

  const startCollaboration = useCallback(async () => {
    if (selectedAgents.length === 0 || !task.trim()) return

    try {
      setLoading(true)
      const config = {
        agents: selectedAgents.map((a) => ({
          agentId: a.id,
          role: a.role,
          provider: a.provider,
          model: a.model,
        })),
        mode: 'swarm',
        maxRounds: 5,
      }

      await request<CollaborationSession>('/api/v1/agent/collaborate', 'POST', {
        query: task,
        config,
      })

      setSession({
        sessionId: Date.now().toString(),
        agents: selectedAgents,
        status: 'running',
        task,
        messages: [],
        events: ['协作已启动'],
      })

      onSendMessage?.(task, selectedAgents)
    } catch (err) {
      setError('启动协作失败')
    } finally {
      setLoading(false)
    }
  }, [selectedAgents, task, onSendMessage])

  const stopCollaboration = useCallback(() => {
    setSession((prev) => prev ? { ...prev, status: 'completed' } : null)
  }, [])

  const recommendAgents = useCallback(async () => {
    if (!task.trim()) return
    try {
      setLoading(true)
      const result = await request<{ agents: AgentInfo[] }>('/api/v1/agents/recommend', 'POST', {
        task,
        maxAgents: 4,
      })
      const recommended = (result as { agents: AgentInfo[] })?.agents || []
      if (recommended.length > 0) {
        setSelectedAgents(recommended)
      }
    } catch (err) {
      setError('推荐 Agent 失败')
    } finally {
      setLoading(false)
    }
  }, [task])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-text-primary">Agent 协作</span>
          {session && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              session.status === 'running'
                ? 'bg-green-400/10 text-green-400'
                : session.status === 'error'
                ? 'bg-red-400/10 text-red-400'
                : 'bg-gray-400/10 text-gray-400'
            }`}>
              {session.status === 'running' ? '运行中' : session.status === 'completed' ? '已完成' : session.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadAgents}
            className="p-1.5 rounded-lg hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
            title="刷新 Agent 列表"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-lg hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 任务输入区 */}
      <div className="p-4 border-b border-border">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="描述你要协作完成的任务..."
              rows={2}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-xl text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-violet-500/50 resize-none"
            />
            <button
              onClick={recommendAgents}
              disabled={!task.trim() || loading}
              className="absolute bottom-2 right-2 p-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-30"
              title="AI 推荐 Agent 团队"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 已选 Agent */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedAgents.map((agent) => (
            <span
              key={agent.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${ROLE_COLORS[agent.role] || ROLE_COLORS.custom}`}
            >
              <Bot className="w-3 h-3" />
              {agent.displayName || agent.name}
              <button
                onClick={() => toggleAgent(agent)}
                className="ml-0.5 hover:opacity-70"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowAgentPicker(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-dashed border-border text-text-muted hover:border-violet-500/30 hover:text-violet-400 transition-colors"
          >
            <UserPlus className="w-3 h-3" />
            添加 Agent
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mt-3">
          {!session || session.status !== 'running' ? (
            <button
              onClick={startCollaboration}
              disabled={selectedAgents.length === 0 || !task.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg text-xs font-medium hover:from-violet-500 hover:to-purple-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              开始协作
            </button>
          ) : (
            <button
              onClick={stopCollaboration}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-all"
            >
              <Square className="w-3.5 h-3.5" />
              停止协作
            </button>
          )}
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-400/10 text-red-400 text-xs">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {session?.events.map((event, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] bg-violet-400/10 text-violet-400">
              <Clock className="w-3 h-3" />
              {event}
            </span>
          </motion.div>
        ))}

        {session?.messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2"
          >
            <div className={`w-6 h-6 rounded-full ${ROLE_COLORS[session.agents.find((a) => a.id === msg.agentId)?.role || 'custom']} flex items-center justify-center shrink-0 mt-0.5`}>
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-semibold text-text-primary">{msg.agentName}</span>
                <span className="text-[9px] text-text-muted">{msg.type}</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">{msg.content}</p>
            </div>
          </motion.div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Agent 选择器弹窗 */}
      <AnimatePresence>
        {showAgentPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAgentPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-bg-elevated border border-border rounded-2xl shadow-2xl max-w-md w-full mx-4 max-h-[70vh] overflow-y-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-text-primary">选择 Agent</h3>
                <button
                  onClick={() => setShowAgentPicker(false)}
                  className="p-1 rounded-lg hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                  </div>
                ) : availableAgents.length === 0 ? (
                  <p className="text-center text-sm text-text-muted py-8">暂无可用 Agent</p>
                ) : (
                  availableAgents.map((agent) => {
                    const isSelected = selectedAgents.some((a) => a.id === agent.id)
                    return (
                      <button
                        key={agent.id}
                        onClick={() => toggleAgent(agent)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          isSelected
                            ? 'border-violet-500/50 bg-violet-500/5'
                            : 'border-border hover:border-violet-500/20'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text-primary truncate">
                              {agent.displayName || agent.name}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] ${ROLE_COLORS[agent.role] || ROLE_COLORS.custom}`}>
                              {ROLE_LABELS[agent.role] || agent.role}
                            </span>
                          </div>
                          {agent.description && (
                            <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">
                              {agent.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-text-muted">{agent.provider}/{agent.model}</span>
                            <span className="text-[10px] text-text-muted flex items-center gap-1">
                              {agent.status === 'active' ? (
                                <Wifi className="w-2.5 h-2.5 text-green-400" />
                              ) : (
                                <WifiOff className="w-2.5 h-2.5 text-gray-400" />
                              )}
                              {agent.status}
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})