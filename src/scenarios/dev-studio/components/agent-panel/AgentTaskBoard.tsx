/**
 * AgentTaskBoard - 任务看板（Kanban 布局）
 *
 * 按状态分列展示任务：Pending / In Progress / Completed / Blocked
 * 支持拖拽感知占位，展示任务分配、优先级等。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { Plus, ListTodo } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { agentSessionService } from '../../services/AgentSessionService'
import type { AgentSessionState } from '../../services/AgentSessionService'
import type { AgentRole, SessionTask } from '../../types'

interface AgentTaskBoardProps {
  session?: AgentSessionState | null
  projectId?: string
  onSendMessage?: (content: string, to: AgentRole | 'broadcast') => void
}

const COLUMN_KEYS: SessionTask['status'][] = ['pending', 'in_progress', 'completed', 'blocked']

const COLUMN_COLORS: Record<string, string> = {
  pending: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  completed: 'bg-emerald-500',
  blocked: 'bg-red-500',
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-orange-400',
  low: 'border-l-slate-300',
}

const AgentTaskBoard: React.FC<AgentTaskBoardProps> = ({
  session,
  projectId: _projectId,
  onSendMessage,
}) => {
  const { t } = useI18n()
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState<AgentRole | ''>('')
  const [newTaskPriority, setNewTaskPriority] = useState<SessionTask['priority']>('medium')
  const [showAddForm, setShowAddForm] = useState(false)
  const [adding, setAdding] = useState(false)

  const tasksByStatus = session
    ? session.session.tasks.reduce((acc, task) => {
        acc[task.status].push(task)
        return acc
      }, { pending: [] as SessionTask[], in_progress: [] as SessionTask[], completed: [] as SessionTask[], blocked: [] as SessionTask[] })
    : { pending: [], in_progress: [], completed: [], blocked: [] }

  // 无会话时
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <ListTodo className="w-8 h-8 opacity-30" />
        <p className="text-xs">{t('studio.agent.startSessionToManage')}</p>
      </div>
    )
  }

  const handleAddTask = useCallback(async () => {
    if (!newTaskTitle.trim() || adding) return
    setAdding(true)
    try {
      await agentSessionService.addTask({
        title: newTaskTitle.trim(),
        description: '',
        assignee: newTaskAssignee || undefined,
        priority: newTaskPriority,
        status: 'pending',
      })
      onSendMessage?.(
        t('studio.agent.newTask', { title: newTaskTitle, assignee: newTaskAssignee ? ` (${newTaskAssignee})` : '' }),
        'broadcast',
      )
      setNewTaskTitle('')
      setNewTaskAssignee('')
      setNewTaskPriority('medium')
      setShowAddForm(false)
    } catch {
      // silent fail in UI
    } finally {
      setAdding(false)
    }
  }, [newTaskTitle, newTaskAssignee, newTaskPriority, adding, onSendMessage])

  const handleUpdateTaskStatus = useCallback(async (taskId: string, status: SessionTask['status']) => {
    try {
      await agentSessionService.updateTaskStatus(taskId, status)
    } catch {
      // silent fail
    }
  }, [])

  const totalTasks = session.session.tasks.length
  const completedTasks = tasksByStatus.completed.length

  return (
    <div className="flex flex-col h-full">
      {/* 头部统计 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{t('studio.agent.tasks')}</span>
          <span className="text-[10px] text-muted-foreground">
            {t('studio.agent.totalTasks', { total: totalTasks, done: completedTasks })}
          </span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t('studio.agent.add')}
        </button>
      </div>

      {/* 添加任务表单 */}
      {showAddForm && (
        <div className="px-3 py-2 border-b border-border bg-muted/20 space-y-1.5">
          <input
            type="text"
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder={t('studio.agent.taskTitlePlaceholder')}
            className="w-full px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:border-primary"
            onKeyDown={e => e.key === 'Enter' && handleAddTask()}
          />
          <div className="flex gap-1.5">
            <select
              value={newTaskAssignee}
              onChange={e => setNewTaskAssignee(e.target.value as AgentRole | '')}
              className="flex-1 px-2 py-1 rounded border border-border bg-background text-[10px]"
            >
              <option value="">{t('studio.agent.unassigned')}</option>
              {session.agents.map(a => (
                <option key={a.role} value={a.role}>{a.role}</option>
              ))}
            </select>
            <select
              value={newTaskPriority}
              onChange={e => setNewTaskPriority(e.target.value as SessionTask['priority'])}
              className="px-2 py-1 rounded border border-border bg-background text-[10px]"
            >
              <option value="high">{t('studio.agent.priority.high')}</option>
              <option value="medium">{t('studio.agent.priority.medium')}</option>
              <option value="low">{t('studio.agent.priority.low')}</option>
            </select>
          </div>
        </div>
      )}

      {/* Kanban 列 */}
      <div className="flex-1 flex gap-1 p-2 overflow-auto">
        {COLUMN_KEYS.map(colId => {
          const tasks = tasksByStatus[colId]
          return (
            <div key={colId} className="flex-1 min-w-[120px] flex flex-col">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${COLUMN_COLORS[colId]}`} />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t(`studio.agent.status.${colId === 'in_progress' ? 'inProgress' : colId}`)}
                </span>
                <span className="text-[10px] text-muted-foreground/50">{tasks.length}</span>
              </div>
              <div className="flex-1 space-y-1 overflow-auto">
                {tasks.map((task: SessionTask) => {
                    const nextStatus: Record<string, SessionTask['status']> = {
                      pending: 'in_progress',
                      in_progress: 'completed',
                      completed: 'pending',
                      blocked: 'in_progress',
                    }
                    return (
                      <div
                        key={task.id}
                        onClick={() => handleUpdateTaskStatus(task.id, nextStatus[task.status])}
                        className={`px-2 py-1.5 rounded border border-border bg-card hover:border-primary/30 transition-colors border-l-2 cursor-pointer ${PRIORITY_COLORS[task.priority] ?? 'border-l-slate-300'}`}
                        title={t('studio.agent.clickToAdvance')}
                      >
                    <div className="text-[11px] leading-tight">{task.title}</div>
                    <div className="flex items-center gap-1 mt-1">
                      {task.assignee && (
                        <span className="px-1 py-0.5 rounded bg-muted/50 text-[9px] text-muted-foreground">
                          {task.assignee}
                        </span>
                      )}
                      {task.priority === 'high' && (
                        <span className="px-1 py-0.5 rounded bg-red-500/10 text-[9px] text-red-500">H</span>
                      )}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AgentTaskBoard