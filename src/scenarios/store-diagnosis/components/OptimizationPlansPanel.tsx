import { useState, useCallback, useEffect } from 'react'
import { ClipboardList, RefreshCw, ChevronRight, ChevronDown, Plus, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface PlanRecord {
  id: string
  store_id: string
  title: string
  description: string
  status: string
  priority: string
  expected_roi: number
  created_at: string
  updated_at: string
}

interface TaskRecord {
  id: string
  plan_id: string
  title: string
  status: string
  assignee: string
  due_date: string
}

interface StoreName {
  id: string
  name: string
}

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string; icon: typeof CheckCircle2 }> = {
  draft: { zh: '草稿', en: 'Draft', color: 'text-text-muted', icon: Clock },
  active: { zh: '进行中', en: 'Active', color: 'text-blue-400', icon: AlertCircle },
  completed: { zh: '已完成', en: 'Completed', color: 'text-green-400', icon: CheckCircle2 },
  cancelled: { zh: '已取消', en: 'Cancelled', color: 'text-text-muted', icon: Clock },
}

const PRIORITY_CONFIG: Record<string, { zh: string; en: string; color: string }> = {
  high: { zh: '高', en: 'High', color: 'text-red-400' },
  medium: { zh: '中', en: 'Medium', color: 'text-yellow-400' },
  low: { zh: '低', en: 'Low', color: 'text-green-400' },
}

export function OptimizationPlansPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [tasks, setTasks] = useState<Record<string, TaskRecord[]>>({})
  const [storeNames, setStoreNames] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const sendToChat = useCallback(async (prompt: string) => {
    try {
      const agentConfig = getAgentConfig()
      await Agent.send(
        prompt,
        { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
        workspacePath,
        'agent',
      )
    } catch {}
  }, [llmConfig, workspacePath])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const storeResult = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT id, name FROM stores')
      if (storeResult.success && storeResult.rows) {
        const map: Record<string, string> = {}
        for (const row of storeResult.rows) {
          map[(row as unknown as StoreName).id] = (row as unknown as StoreName).name
        }
        setStoreNames(map)
      }

      const planResult = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT * FROM optimization_plans ORDER BY created_at DESC')
      if (planResult.success && planResult.rows) {
        setPlans(planResult.rows as unknown as PlanRecord[])
      }

      const taskResult = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT * FROM plan_tasks ORDER BY due_date')
      if (taskResult.success && taskResult.rows) {
        const taskMap: Record<string, TaskRecord[]> = {}
        for (const row of taskResult.rows as unknown as TaskRecord[]) {
          if (!taskMap[row.plan_id]) taskMap[row.plan_id] = []
          taskMap[row.plan_id].push(row)
        }
        setTasks(taskMap)
      }
    } catch {
      setPlans([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleCreatePlan = useCallback(() => {
    const prompt = language === 'zh'
      ? '请帮我创建一个门店优化方案，先列出所有门店供我选择'
      : 'Please help me create an optimization plan. List all stores first for me to choose'
    sendToChat(prompt)
    setShowCreate(false)
  }, [language, sendToChat])

  const handleViewPlan = useCallback((plan: PlanRecord) => {
    const storeName = storeNames[plan.store_id] || plan.store_id
    const prompt = language === 'zh'
      ? `请展示门店「${storeName}」的优化方案「${plan.title}」的详细内容`
      : `Please show the details of optimization plan "${plan.title}" for store "${storeName}"`
    sendToChat(prompt)
  }, [language, sendToChat, storeNames])

  const taskStats = useCallback((planId: string) => {
    const planTasks = tasks[planId] || []
    const completed = planTasks.filter(t => t.status === 'completed').length
    const total = planTasks.length
    return { completed, total }
  }, [tasks])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '优化方案' : 'PLANS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadData} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowCreate(true)} title={language === 'zh' ? '新建方案' : 'New Plan'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {plans.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-text-muted">
            <ClipboardList className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">{language === 'zh' ? '暂无优化方案' : 'No plans yet'}</p>
            <p className="text-xs mt-1 opacity-70">{language === 'zh' ? '诊断后可生成优化方案' : 'Generate plans after diagnosis'}</p>
          </div>
        )}

        {plans.map((plan) => {
          const isExpanded = expandedId === plan.id
          const storeName = storeNames[plan.store_id] || plan.store_id
          const statusInfo = STATUS_CONFIG[plan.status] || STATUS_CONFIG.draft
          const priorityInfo = PRIORITY_CONFIG[plan.priority] || PRIORITY_CONFIG.medium
          const stats = taskStats(plan.id)
          const StatusIcon = statusInfo.icon

          return (
            <div key={plan.id}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : plan.id)}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
                <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusInfo.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary truncate">{plan.title}</div>
                  <div className="text-xs text-text-muted">{storeName}</div>
                </div>
                <span className={`text-xs ${priorityInfo.color}`}>{priorityInfo[language === 'zh' ? 'zh' : 'en']}</span>
              </button>

              {isExpanded && (
                <div className="pl-8 pr-3 pb-2 space-y-1.5">
                  {plan.description && (
                    <div className="text-xs text-text-secondary leading-relaxed">{plan.description}</div>
                  )}
                  {plan.expected_roi > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">{language === 'zh' ? '预期ROI' : 'Expected ROI'}</span>
                      <span className="text-green-400">{plan.expected_roi}%</span>
                    </div>
                  )}
                  {stats.total > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">{language === 'zh' ? '任务进度' : 'Tasks'}</span>
                      <span className="text-text-secondary">{stats.completed}/{stats.total}</span>
                    </div>
                  )}
                  {stats.total > 0 && (
                    <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                  {(tasks[plan.id] || []).map(task => (
                    <div key={task.id} className="flex items-center gap-1.5 text-xs">
                      <span className={task.status === 'completed' ? 'text-green-400' : 'text-text-muted'}>
                        {task.status === 'completed' ? '✓' : '○'}
                      </span>
                      <span className={`flex-1 truncate ${task.status === 'completed' ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                  <ActionButton variant="ghost" size="sm" className="h-6 w-full text-xs gap-1" onClick={() => handleViewPlan(plan)}>
                    {language === 'zh' ? '查看详情' : 'View Details'}
                  </ActionButton>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div className="border-t border-border/30 p-3 space-y-2 bg-surface/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">
              {language === 'zh' ? '创建优化方案' : 'Create Plan'}
            </span>
            <button onClick={() => setShowCreate(false)} className="text-text-muted hover:text-text-primary">×</button>
          </div>
          <p className="text-xs text-text-muted">
            {language === 'zh'
              ? 'AI 将根据诊断结果自动生成优化方案和任务清单'
              : 'AI will auto-generate optimization plans and task lists based on diagnosis results'}
          </p>
          <ActionButton variant="secondary" size="sm" className="h-7 w-full text-xs" onClick={handleCreatePlan}>
            {language === 'zh' ? '开始创建' : 'Start Creating'}
          </ActionButton>
        </div>
      )}

      {!showCreate && plans.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '新建方案' : 'New Plan'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}
