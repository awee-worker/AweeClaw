import { useState, useCallback, useEffect } from 'react'
import {
  Clock, Plus, Trash2, Play, Pause, Edit2, RefreshCw, ChevronDown, ChevronRight, AlertCircle, X,
} from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { countAutomationTasks } from '@renderer/adapters/quotaUsage'
import { t, type Language } from '@renderer/i18n'

interface CronTaskItem {
  id: string
  name: string
  description: string
  expression: string
  command: string
  agentId?: string
  status: 'active' | 'paused' | 'running' | 'completed' | 'error'
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  maxCalls: number
  lastError: string | null
  createdAt: number
  hookEvent?: string
}

const STATUS_CONFIG = {
  active: { label: 'Active', labelZh: '运行中', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  paused: { label: 'Paused', labelZh: '已暂停', dot: 'bg-amber-400', text: 'text-amber-400' },
  running: { label: 'Running', labelZh: '执行中', dot: 'bg-blue-400', text: 'text-blue-400' },
  completed: { label: 'Completed', labelZh: '已完成', dot: 'bg-slate-400', text: 'text-slate-400' },
  error: { label: 'Error', labelZh: '错误', dot: 'bg-red-400', text: 'text-red-400' },
}

function formatTime(ts: number | null): string {
  if (!ts || ts <= 0) return '-'
  return new Date(ts).toLocaleString()
}

function formatRelative(ts: number | null): string {
  if (!ts || ts <= 0) return '-'
  const diff = ts - Date.now()
  if (diff <= 0) return t('explorer.justNow', 'zh' as Language)
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** 新建/编辑任务的表单 */
function TaskForm({
  initial,
  onSubmit,
  onCancel,
  language,
}: {
  initial?: Partial<CronTaskItem>
  onSubmit: (data: { name: string; description: string; expression: string; command: string; maxCalls: number }) => void
  onCancel: () => void
  language: Language
}) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [expression, setExpression] = useState(initial?.expression || '')
  const [command, setCommand] = useState(initial?.command || '')
  const [maxCalls, setMaxCalls] = useState(initial?.maxCalls || 0)
  const [mode, setMode] = useState<'visual' | 'cron'>(initial?.expression ? 'cron' : 'visual')
  const [vMinute, setVMinute] = useState('0')
  const [vHour, setVHour] = useState('9')
  const [vFrequency, setVFrequency] = useState<'daily' | 'hourly' | 'weekly' | 'monthly' | 'custom'>('daily')
  const [vWeekday, setVWeekday] = useState('1')

  // 根据可视化配置生成 cron 表达式
  const buildPattern = useCallback(() => {
    switch (vFrequency) {
      case 'hourly': return `${vMinute} * * * *`
      case 'daily': return `${vMinute} ${vHour} * * *`
      case 'weekly': return `${vMinute} ${vHour} * * ${vWeekday}`
      case 'monthly': return `${vMinute} ${vHour} 1 * *`
      case 'custom': return expression
    }
  }, [vFrequency, vMinute, vHour, vWeekday, expression])

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !command.trim()) return
    const pattern = mode === 'visual' ? buildPattern() : expression
    if (!pattern.trim()) return
    onSubmit({ name: name.trim(), description: description.trim(), expression: pattern.trim(), command: command.trim(), maxCalls })
  }, [name, description, expression, command, maxCalls, mode, buildPattern, onSubmit])

  const weekdays = [
    { value: '0', labelZh: '周日', label: 'Sun' },
    { value: '1', labelZh: '周一', label: 'Mon' },
    { value: '2', labelZh: '周二', label: 'Tue' },
    { value: '3', labelZh: '周三', label: 'Wed' },
    { value: '4', labelZh: '周四', label: 'Thu' },
    { value: '5', labelZh: '周五', label: 'Fri' },
    { value: '6', labelZh: '周六', label: 'Sat' },
  ]

  return (
    <div className="space-y-3 p-3">
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {language === 'zh' ? '任务名称' : 'Task Name'} *
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={language === 'zh' ? '例如：每日摘要' : 'e.g., Daily Summary'}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {language === 'zh' ? '描述' : 'Description'}
        </label>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={language === 'zh' ? '简述任务用途' : 'Brief description'}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {language === 'zh' ? '调度规则' : 'Schedule'}
        </label>
        <div className="flex gap-1.5 mb-2">
          {(['visual', 'cron'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                mode === m
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-surface/40 text-text-secondary border border-border/30 hover:bg-surface-hover'
              }`}
            >
              {m === 'visual' ? (language === 'zh' ? '可视化' : 'Visual') : 'Cron'}
            </button>
          ))}
        </div>

        {mode === 'visual' ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={vFrequency}
                onChange={e => setVFrequency(e.target.value as any)}
                className="flex-1 px-2 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary focus:outline-none focus:border-accent/50"
              >
                <option value="daily">{language === 'zh' ? '每天' : 'Daily'}</option>
                <option value="hourly">{language === 'zh' ? '每小时' : 'Hourly'}</option>
                <option value="weekly">{language === 'zh' ? '每周' : 'Weekly'}</option>
                <option value="monthly">{language === 'zh' ? '每月' : 'Monthly'}</option>
                <option value="custom">{language === 'zh' ? '自定义 Cron' : 'Custom Cron'}</option>
              </select>
            </div>
            {vFrequency !== 'hourly' && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-text-muted mb-0.5">{language === 'zh' ? '时' : 'Hour'}</label>
                  <input
                    type="number"
                    min={0} max={23}
                    value={vHour}
                    onChange={e => setVHour(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary focus:outline-none focus:border-accent/50"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-text-muted mb-0.5">{language === 'zh' ? '分' : 'Min'}</label>
                  <input
                    type="number"
                    min={0} max={59}
                    value={vMinute}
                    onChange={e => setVMinute(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary focus:outline-none focus:border-accent/50"
                  />
                </div>
              </div>
            )}
            {vFrequency === 'hourly' && (
              <div>
                <label className="block text-xs text-text-muted mb-0.5">{language === 'zh' ? '分钟' : 'Minute'}</label>
                <input
                  type="number"
                  min={0} max={59}
                  value={vMinute}
                  onChange={e => setVMinute(e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary focus:outline-none focus:border-accent/50"
                />
              </div>
            )}
            {vFrequency === 'weekly' && (
              <div className="flex flex-wrap gap-1">
                {weekdays.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setVWeekday(d.value)}
                    className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${
                      vWeekday === d.value
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-surface/40 text-text-secondary border border-border/30'
                    }`}
                  >
                    {language === 'zh' ? d.labelZh : d.label}
                  </button>
                ))}
              </div>
            )}
            {vFrequency === 'custom' && (
              <input
                value={expression}
                onChange={e => setExpression(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full px-2.5 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
              />
            )}
            <div className="text-xs text-text-muted font-mono bg-surface/30 px-2 py-1 rounded border border-border/20">
              {language === 'zh' ? '表达式' : 'Pattern'}: {buildPattern()}
            </div>
          </div>
        ) : (
          <input
            value={expression}
            onChange={e => setExpression(e.target.value)}
            placeholder="0 9 * * *"
            className="w-full px-2.5 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
          />
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {language === 'zh' ? '执行指令' : 'Command'} *
        </label>
        <textarea
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder={language === 'zh' ? '触发时发送给 AI 的自然语言指令' : 'Natural language instruction sent to AI when triggered'}
          rows={3}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {language === 'zh' ? '最大执行次数' : 'Max Calls'}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={maxCalls}
            onChange={e => setMaxCalls(parseInt(e.target.value) || 0)}
            className="w-20 px-2 py-1 text-xs bg-surface/60 border border-border/50 rounded-md text-text-primary focus:outline-none focus:border-accent/50"
          />
          <span className="text-xs text-text-muted">{language === 'zh' ? '0 = 不限' : '0 = unlimited'}</span>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !command.trim() || !(mode === 'visual' ? buildPattern().trim() : expression.trim())}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {initial ? (language === 'zh' ? '保存' : 'Save') : (language === 'zh' ? '创建' : 'Create')}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface/40 text-text-secondary border border-border/30 hover:bg-surface-hover transition-colors"
        >
          {language === 'zh' ? '取消' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

/** 单个任务卡片 */
function TaskCard({
  task,
  language,
  onToggle,
  onDelete,
  onEdit,
}: {
  task: CronTaskItem
  language: Language
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onEdit: (task: CronTaskItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.paused

  return (
    <div className="group border border-border/30 rounded-lg bg-surface/20 hover:bg-surface/40 transition-colors">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusCfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary truncate">{task.name}</div>
          <div className="text-xs text-text-muted font-mono">{task.expression}</div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.status !== 'completed' && (
            <button
              onClick={e => { e.stopPropagation(); onToggle(task.id, task.status !== 'active') }}
              className="p-1 rounded hover:bg-surface-hover transition-colors"
              title={task.status === 'active' ? (language === 'zh' ? '暂停' : 'Pause') : (language === 'zh' ? '启用' : 'Enable')}
            >
              {task.status === 'active'
                ? <Pause className="w-3 h-3 text-amber-400" />
                : <Play className="w-3 h-3 text-emerald-400" />
              }
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onEdit(task) }}
            className="p-1 rounded hover:bg-surface-hover transition-colors"
            title={language === 'zh' ? '编辑' : 'Edit'}
          >
            <Edit2 className="w-3 h-3 text-text-muted" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(task.id) }}
            className="p-1 rounded hover:bg-surface-hover transition-colors"
            title={language === 'zh' ? '删除' : 'Delete'}
          >
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        </div>
        {expanded ? <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/20 pt-2">
          {task.description && (
            <div className="text-xs text-text-secondary">{task.description}</div>
          )}
          <div className="text-xs text-text-secondary">
            <span className="text-text-muted">{language === 'zh' ? '指令' : 'Command'}: </span>
            {task.command}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div>
              <span className="text-text-muted">{language === 'zh' ? '状态' : 'Status'}: </span>
              <span className={statusCfg.text}>{statusCfg[language === 'zh' ? 'labelZh' : 'label']}</span>
            </div>
            <div>
              <span className="text-text-muted">{language === 'zh' ? '执行次数' : 'Runs'}: </span>
              <span className="text-text-primary">{task.runCount}{task.maxCalls > 0 ? `/${task.maxCalls}` : ''}</span>
            </div>
            <div>
              <span className="text-text-muted">{language === 'zh' ? '下次执行' : 'Next'}: </span>
              <span className="text-text-primary">{formatRelative(task.nextRunAt)}</span>
            </div>
            <div>
              <span className="text-text-muted">{language === 'zh' ? '上次执行' : 'Last'}: </span>
              <span className="text-text-primary">{formatTime(task.lastRunAt)}</span>
            </div>
          </div>
          {task.lastError && (
            <div className="flex items-start gap-1 text-xs text-red-400 bg-red-400/5 px-2 py-1 rounded border border-red-400/10">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="break-all">{task.lastError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ScheduleExplorer() {
  const language = useStore(s => s.language) as Language
  const setActiveSidePanel = useStore(s => s.setActiveSidePanel)
  // 定时任务计入「自动化任务」配额（automationTasksLimit）
  const { requireQuota } = useFeatureGuard()
  const [tasks, setTasks] = useState<CronTaskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<CronTaskItem | null>(null)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.cron.getAllTasks()
      if (result.success && result.tasks) {
        setTasks(result.tasks)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // 监听 Cron 任务状态变更，实时更新 UI
  useEffect(() => {
    const unsub = api.cron.onTaskStateChanged((taskData: CronTaskItem) => {
      setTasks(prev => prev.map(t => t.id === taskData.id ? { ...t, ...taskData } : t))
    })
    return unsub
  }, [])

  /** 自动化任务数量校验（自动化规则 + 定时任务合并计数），超限时给出升级引导 */
  const checkAutomationQuota = useCallback(async (): Promise<boolean> => {
    // -1 表示两处数据源都不可达、用量未知 —— 按宽松策略放行
    const used = await countAutomationTasks()
    if (used < 0) return true
    return requireQuota('automationTasksLimit', used)
  }, [requireQuota])

  /** 打开新建表单：先校验配额，再展示表单 */
  const handleOpenCreateForm = useCallback(async () => {
    if (!(await checkAutomationQuota())) return
    setEditingTask(null)
    setShowForm(true)
  }, [checkAutomationQuota])

  const handleCreate = useCallback(async (data: { name: string; description: string; expression: string; command: string; maxCalls: number }) => {
    // 兜底二次校验：表单可能已打开一段时间，期间自动化任务数可能已达上限
    if (!(await checkAutomationQuota())) return
    try {
      await api.cron.register({
        name: data.name,
        description: data.description,
        expression: data.expression,
        command: data.command,
        maxCalls: data.maxCalls,
        active: true,
      })
      setShowForm(false)
      loadTasks()
    } catch {
      // ignore
    }
  }, [loadTasks, checkAutomationQuota])

  const handleUpdate = useCallback(async (data: { name: string; description: string; expression: string; command: string; maxCalls: number }) => {
    if (!editingTask) return
    try {
      await api.cron.update(editingTask.id, {
        name: data.name,
        description: data.description,
        expression: data.expression,
        command: data.command,
        maxCalls: data.maxCalls,
      })
      setEditingTask(null)
      loadTasks()
    } catch {
      // ignore
    }
  }, [editingTask, loadTasks])

  const handleToggle = useCallback(async (taskId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await api.cron.resume(taskId)
      } else {
        await api.cron.pause(taskId)
      }
      loadTasks()
    } catch {
      // ignore
    }
  }, [loadTasks])

  const handleDelete = useCallback(async (taskId: string) => {
    try {
      await api.cron.unregister(taskId)
      loadTasks()
    } catch {
      // ignore
    }
  }, [loadTasks])

  const activeTasks = tasks.filter(t => t.status === 'active')
  const pausedTasks = tasks.filter(t => t.status === 'paused' || t.status === 'completed' || t.status === 'error')

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Header */}
      <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
        <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-xs font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
          {language === 'zh' ? '定时任务' : 'Schedule'}
        </span>
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <span>{activeTasks.length}</span>
          <span>/</span>
          <span>{tasks.length}</span>
          <button onClick={loadTasks} className="ml-1 p-0.5 rounded hover:bg-surface-hover transition-colors" title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleOpenCreateForm} className="ml-0.5 p-0.5 rounded hover:bg-surface-hover transition-colors" title={language === 'zh' ? '新建任务' : 'New Task'}>
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setActiveSidePanel(null)} className="ml-0.5 p-0.5 rounded hover:bg-surface-hover transition-colors" title={language === 'zh' ? '关闭' : 'Close'}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
        {showForm && (
          <div className="border border-accent/20 rounded-lg bg-accent/5">
            <TaskForm
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
              language={language}
            />
          </div>
        )}

        {editingTask && (
          <div className="border border-accent/20 rounded-lg bg-accent/5">
            <TaskForm
              initial={editingTask}
              onSubmit={handleUpdate}
              onCancel={() => setEditingTask(null)}
              language={language}
            />
          </div>
        )}

        {tasks.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Clock className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-xs mb-1">{language === 'zh' ? '暂无定时任务' : 'No scheduled tasks'}</p>
            <p className="text-xs opacity-60">{language === 'zh' ? '点击 + 创建或让 AI 帮你创建' : 'Click + to create or ask AI to create one'}</p>
          </div>
        ) : (
          <>
            {activeTasks.length > 0 && (
              <div className="space-y-2">
                {activeTasks.map(task => (
                  <TaskCard key={task.id} task={task} language={language} onToggle={handleToggle} onDelete={handleDelete} onEdit={setEditingTask} />
                ))}
              </div>
            )}
            {pausedTasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-text-muted font-semibold uppercase tracking-wider px-1">
                  {language === 'zh' ? '已暂停' : 'Paused'}
                </div>
                {pausedTasks.map(task => (
                  <TaskCard key={task.id} task={task} language={language} onToggle={handleToggle} onDelete={handleDelete} onEdit={setEditingTask} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-border/30 text-xs text-text-muted/60">
        {language === 'zh'
          ? '提示：让 AI 使用 schedule 工具创建任务'
          : 'Tip: Ask AI to create tasks via schedule tool'}
      </div>
    </div>
  )
}
