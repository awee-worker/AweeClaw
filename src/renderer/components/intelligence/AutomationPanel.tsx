/**
 * 自动化规则面板（客户端）
 * 管理个人自动化规则：触发条件、执行动作、执行历史
 */
import { memo, useState, useCallback, useEffect } from 'react'
import {
  Zap,
  Play,
  Square,
  Plus,
  X,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowRight,
  Trash2,
  Edit,
  History,
  Bell,
  Globe,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { getServerUrl, getAccessToken, tryRefreshToken } from '@renderer/adapters/backendApi'

interface AutomationRule {
  id: string
  name: string
  description: string | null
  triggerType: string
  triggerConfig: Record<string, unknown>
  actionType: string
  actionConfig: Record<string, unknown>
  enabled: boolean
  priority: number
  cooldownSeconds: number
  maxExecutions: number | null
  executionCount: number
  lastExecutedAt: string | null
  createdAt: string
}

interface ExecutionLog {
  id: string
  ruleId: string
  ruleName: string
  status: 'success' | 'error'
  result: string | null
  error: string | null
  duration: number
  executedAt: string
}

const TRIGGER_ICONS: Record<string, typeof Zap> = {
  schedule: Clock,
  event: Bell,
  webhook: Globe,
  manual: Zap,
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: '定时触发',
  event: '事件触发',
  webhook: 'Webhook',
  manual: '手动触发',
}

const ACTION_LABELS: Record<string, string> = {
  send_message: '发送消息',
  call_agent: '调用Agent',
  execute_workflow: '执行工作流',
  send_email: '发送邮件',
  call_webhook: '调用Webhook',
}

interface AutomationPanelProps {
  className?: string
}

export const AutomationPanel = memo(function AutomationPanel({
  className = '',
}: AutomationPanelProps) {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'rules' | 'history'>('rules')

  async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET', body?: unknown): Promise<T> {
    const url = `${getServerUrl()}${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
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

  const loadRules = useCallback(async () => {
    try {
      setLoading(true)
      const result = await request<{ data: AutomationRule[] }>('/automation-rules')
      setRules(result.data || [])
      setError(null)
    } catch (err) {
      setError('加载规则失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true)
      const result = await request<{ data: ExecutionLog[] }>('/automation-rules/executions')
      setLogs(result.data || [])
      setError(null)
    } catch (err) {
      setError('加载日志失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const toggleRule = useCallback(async (rule: AutomationRule) => {
    try {
      await request(`/automation-rules/${rule.id}`, 'PATCH', { enabled: !rule.enabled })
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      )
    } catch (err) {
      setError('更新规则失败')
    }
  }, [])

  const deleteRule = useCallback(async (rule: AutomationRule) => {
    try {
      await request(`/automation-rules/${rule.id}`, 'DELETE')
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
    } catch (err) {
      setError('删除规则失败')
    }
  }, [])

  const executeRule = useCallback(async (rule: AutomationRule) => {
    try {
      await request(`/automation-rules/${rule.id}/execute`, 'POST')
      loadLogs()
    } catch (err) {
      setError('执行规则失败')
    }
  }, [loadLogs])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-text-primary">自动化</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => activeTab === 'rules' ? loadRules() : loadLogs()}
            className="p-1.5 rounded-lg hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={loadRules}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-xs font-medium hover:bg-amber-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('rules')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'rules'
              ? 'text-amber-400 border-b-2 border-amber-400'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          规则 ({rules.length})
        </button>
        <button
          onClick={() => { setActiveTab('history'); loadLogs(); }}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-amber-400 border-b-2 border-amber-400'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          执行历史
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-400/10 text-red-400 text-xs">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'rules' ? (
          <div className="p-3 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12">
                <Zap className="w-8 h-8 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">暂无自动化规则</p>
                <button
                  onClick={loadRules}
                  className="mt-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-xs hover:bg-amber-500/20 transition-colors"
                >
                  创建第一条规则
                </button>
              </div>
            ) : (
              rules.map((rule) => {
                const TriggerIcon = TRIGGER_ICONS[rule.triggerType] || Zap
                return (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl border border-border bg-bg-elevated hover:border-amber-500/20 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary truncate">{rule.name}</span>
                          <span className={`w-2 h-2 rounded-full ${rule.enabled ? 'bg-green-400' : 'bg-gray-400'}`} />
                        </div>
                        {rule.description && (
                          <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">{rule.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-400/10 text-amber-400">
                            <TriggerIcon className="w-2.5 h-2.5" />
                            {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
                          </span>
                          <ArrowRight className="w-3 h-3 text-text-muted" />
                          <span className="text-[10px] text-text-muted">
                            {ACTION_LABELS[rule.actionType] || rule.actionType}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            已执行 {rule.executionCount} 次
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          onClick={() => executeRule(rule)}
                          className="p-1 rounded hover:bg-green-400/10 text-text-muted hover:text-green-400 transition-colors"
                          title="手动执行"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleRule(rule)}
                          className={`p-1 rounded transition-colors ${
                            rule.enabled
                              ? 'hover:bg-amber-400/10 text-amber-400'
                              : 'hover:bg-green-400/10 text-text-muted'
                          }`}
                          title={rule.enabled ? '禁用' : '启用'}
                        >
                          {rule.enabled ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { }}
                          className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary transition-colors"
                          title="编辑"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteRule(rule)}
                          className="p-1 rounded hover:bg-red-400/10 text-text-muted hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })
            )}
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12">
                <History className="w-8 h-8 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">暂无执行记录</p>
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2.5 rounded-lg border border-border bg-bg-elevated"
                >
                  <div className={`shrink-0 mt-0.5 ${
                    log.status === 'success' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {log.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary">{log.ruleName}</span>
                      <span className="text-[10px] text-text-muted">{log.duration}ms</span>
                    </div>
                    {log.error && (
                      <p className="text-[11px] text-red-400 mt-0.5">{log.error}</p>
                    )}
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {new Date(log.executedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
})