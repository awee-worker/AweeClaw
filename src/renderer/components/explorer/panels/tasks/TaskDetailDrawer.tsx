/**
 * TaskDetailDrawer — 任务详情抽屉
 *
 * 从右侧滑入的面板，展示任务完整信息：
 * - 标题、描述、状态、优先级
 * - 截止时间、预估/实际耗时
 * - 标签、来源
 * - 创建/更新时间
 *
 * 提供操作：编辑、删除、状态切换
 */
import {
  X, Edit2, Trash2, Clock, Calendar, Tag, FileText,
  CheckCircle2, Circle, MessageSquare, Zap, Loader2, Copy,
} from 'lucide-react'
import { useStore } from '@store'
import type { TaskItem } from './types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from './taskConstants'

interface TaskDetailDrawerProps {
  task: TaskItem
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleStatus: () => void
  /** 让 AI 执行任务 */
  onRunTask?: (task: TaskItem) => void
  /** 是否正在执行该任务 */
  isRunning?: boolean
  /** 复制任务到其他项目 */
  onCopy?: (task: TaskItem) => void
}

export function TaskDetailDrawer({
  task, onClose, onEdit, onDelete, onToggleStatus, onRunTask, isRunning, onCopy,
}: TaskDetailDrawerProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const statusConfig = TASK_STATUS_CONFIG[task.status]
  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
  const isDone = task.status === 'DONE'
  const hasThread = !!task.threadId
  const canRun = !isDone && onRunTask && !isRunning

  return (
    <div className="flex-shrink-0 w-80 border-l border-border/40 bg-surface/20 flex flex-col h-full overflow-hidden animate-fade-in">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-12 border-b border-border/30">
        <span className="text-[12px] font-semibold text-text-muted uppercase tracking-wider">
          {isZh ? '任务详情' : 'Task Detail'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors" title={isZh ? '编辑' : 'Edit'}>
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors" title={isZh ? '删除' : 'Delete'}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors" title={isZh ? '关闭' : 'Close'}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 让 AI 执行按钮 */}
        {onRunTask && (
          <button
            onClick={() => onRunTask(task)}
            disabled={!canRun}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
              canRun
                ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60 cursor-pointer'
                : 'border-border/30 bg-surface/30 text-text-muted cursor-not-allowed'
            }`}
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            <span className="text-[13px] font-medium">
              {isRunning
                ? (isZh ? '正在启动...' : 'Starting...')
                : isDone
                  ? (isZh ? '任务已完成' : 'Task completed')
                  : hasThread
                    ? (isZh ? '继续与 AI 对话' : 'Continue with AI')
                    : (isZh ? '让 AI 执行' : 'Run with AI')}
            </span>
          </button>
        )}

        {/* 状态切换按钮 */}
        <button
          onClick={onToggleStatus}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
            isDone
              ? 'border-green-500/30 bg-green-500/10 text-green-500 hover:bg-green-500/15'
              : 'border-border/40 bg-surface/50 text-text-primary hover:bg-surface-hover/50'
          }`}
        >
          {isDone
            ? <CheckCircle2 className="w-4 h-4" />
            : <Circle className="w-4 h-4" />
          }
          <span className="text-[13px] font-medium">
            {isDone ? (isZh ? '标记为待办' : 'Mark as To Do') : (isZh ? '标记为完成' : 'Mark as Done')}
          </span>
        </button>

        {/* 复制到项目按钮 */}
        {onCopy && (
          <button
            onClick={() => onCopy(task)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-surface/50 text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary transition-colors"
          >
            <Copy className="w-4 h-4" />
            <span className="text-[13px] font-medium">
              {isZh ? '复制到项目' : 'Copy to Project'}
            </span>
          </button>
        )}

        {/* 标题 */}
        <div>
          <div className="text-[11px] text-text-muted mb-1">{isZh ? '标题' : 'Title'}</div>
          <div className={`text-[15px] font-medium text-text-primary ${isDone ? 'line-through opacity-60' : ''}`}>
            {task.title}
          </div>
        </div>

        {/* 描述 */}
        {task.description && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted mb-1.5">
              <FileText className="w-3 h-3" />
              {isZh ? '描述' : 'Description'}
            </div>
            <div className="text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed">
              {task.description}
            </div>
          </div>
        )}

        {/* 属性网格 */}
        <div className="grid grid-cols-2 gap-3">
          {/* 状态 */}
          <div>
            <div className="text-[11px] text-text-muted mb-1">{isZh ? '状态' : 'Status'}</div>
            <div className={`flex items-center gap-1.5 text-[12px] ${statusConfig.color}`}>
              <span className={`w-2 h-2 rounded-full ${statusConfig.dotColor}`} />
              {isZh ? statusConfig.labelZh : statusConfig.label}
            </div>
          </div>

          {/* 优先级 */}
          <div>
            <div className="text-[11px] text-text-muted mb-1">{isZh ? '优先级' : 'Priority'}</div>
            <div className={`flex items-center gap-1.5 text-[12px] ${priorityConfig.color}`}>
              <span className={`w-2 h-2 rounded-full ${priorityConfig.dotColor}`} />
              {isZh ? priorityConfig.labelZh : priorityConfig.label}
            </div>
          </div>

          {/* 截止时间 */}
          {task.dueAt && (
            <div>
              <div className="text-[11px] text-text-muted mb-1">{isZh ? '截止时间' : 'Due Date'}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <Calendar className="w-3 h-3" />
                {new Date(task.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          )}

          {/* 预估耗时 */}
          {task.estimatedMin != null && (
            <div>
              <div className="text-[11px] text-text-muted mb-1">{isZh ? '预估耗时' : 'Estimated'}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <Clock className="w-3 h-3" />
                {formatDuration(task.estimatedMin, isZh)}
              </div>
            </div>
          )}

          {/* 实际耗时 */}
          {task.actualMin != null && (
            <div>
              <div className="text-[11px] text-text-muted mb-1">{isZh ? '实际耗时' : 'Actual'}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <Clock className="w-3 h-3" />
                {formatDuration(task.actualMin, isZh)}
              </div>
            </div>
          )}

          {/* 来源 */}
          <div>
            <div className="text-[11px] text-text-muted mb-1">{isZh ? '来源' : 'Source'}</div>
            <div className="text-[12px] text-text-secondary">
              {formatSource(task.source, isZh)}
            </div>
          </div>

          {/* 关联对话 */}
          {task.threadId && (
            <div>
              <div className="text-[11px] text-text-muted mb-1">{isZh ? '关联对话' : 'Thread'}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-accent">
                <MessageSquare className="w-3 h-3" />
                <span className="truncate" title={task.threadId}>{task.threadId.slice(0, 12)}...</span>
                <span className="text-[11px] text-text-muted">({isZh ? '可继续对话' : 'resumable'})</span>
              </div>
            </div>
          )}
        </div>

        {/* 标签 */}
        {task.tags.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted mb-1.5">
              <Tag className="w-3 h-3" />
              {isZh ? '标签' : 'Tags'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map(tag => (
                <span key={tag} className="text-[12px] px-2 py-0.5 rounded-md bg-surface-hover/50 text-text-secondary">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 时间信息 */}
        <div className="pt-3 border-t border-border/20 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock className="w-3 h-3" />
            {isZh ? '创建于' : 'Created'} {new Date(task.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock className="w-3 h-3" />
            {isZh ? '更新于' : 'Updated'} {new Date(task.updatedAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 工具函数 ───────────────────────────────────────────

function formatDuration(minutes: number, isZh: boolean): string {
  if (minutes < 60) return isZh ? `${minutes}分钟` : `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? isZh ? `${h}小时` : `${h}h` : isZh ? `${h}小时${m}分` : `${h}h ${m}m`
}

function formatSource(source: string, isZh: boolean): string {
  const map: Record<string, [string, string]> = {
    MANUAL: ['Manual', '手动'],
    AI_GENERATED: ['AI', 'AI生成'],
    AUTOMATION: ['Automation', '自动化'],
    PROJECT_TEMPLATE: ['Template', '模板'],
  }
  const entry = map[source]
  return entry ? (isZh ? entry[1] : entry[0]) : source
}
