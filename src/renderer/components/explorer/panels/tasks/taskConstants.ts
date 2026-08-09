/**
 * 任务 / 项目 / 自动化 — 共享常量与 UI 配置
 *
 * 集中管理状态、优先级等的颜色、标签、图标配置，
 * 避免在各组件中散落硬编码，便于统一调整视觉风格。
 */
import type {
  TaskStatus,
  TaskPriority,
  ProjectStatus,
} from './types'

// ─── 任务状态配置 ───────────────────────────────────────

export interface StatusConfig {
  label: string
  labelZh: string
  color: string
  dotColor: string
  bgColor: string
  borderColor: string
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, StatusConfig> = {
  TODO: {
    label: 'To Do',
    labelZh: '待办',
    color: 'text-slate-500',
    dotColor: 'bg-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    labelZh: '进行中',
    color: 'text-blue-500',
    dotColor: 'bg-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  BLOCKED: {
    label: 'Blocked',
    labelZh: '阻塞',
    color: 'text-red-500',
    dotColor: 'bg-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
  },
  DONE: {
    label: 'Done',
    labelZh: '已完成',
    color: 'text-green-500',
    dotColor: 'bg-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
  },
  CANCELED: {
    label: 'Canceled',
    labelZh: '已取消',
    color: 'text-zinc-400',
    dotColor: 'bg-zinc-400',
    bgColor: 'bg-zinc-500/10',
    borderColor: 'border-zinc-500/30',
  },
}

/** 看板列顺序 */
export const KANBAN_COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']

// ─── 任务优先级配置 ─────────────────────────────────────

export interface PriorityConfig {
  label: string
  labelZh: string
  color: string
  dotColor: string
}

export const TASK_PRIORITY_CONFIG: Record<TaskPriority, PriorityConfig> = {
  LOW: { label: 'Low', labelZh: '低', color: 'text-blue-400', dotColor: 'bg-blue-400' },
  MEDIUM: { label: 'Medium', labelZh: '中', color: 'text-amber-400', dotColor: 'bg-amber-400' },
  HIGH: { label: 'High', labelZh: '高', color: 'text-orange-500', dotColor: 'bg-orange-500' },
  URGENT: { label: 'Urgent', labelZh: '紧急', color: 'text-red-500', dotColor: 'bg-red-500' },
}

export const TASK_PRIORITY_ORDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

// ─── 项目状态配置 ───────────────────────────────────────

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, StatusConfig> = {
  PLANNING: {
    label: 'Planning',
    labelZh: '规划中',
    color: 'text-purple-500',
    dotColor: 'bg-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
  },
  ACTIVE: {
    label: 'Active',
    labelZh: '进行中',
    color: 'text-green-500',
    dotColor: 'bg-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
  },
  ON_HOLD: {
    label: 'On Hold',
    labelZh: '暂停',
    color: 'text-amber-500',
    dotColor: 'bg-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  COMPLETED: {
    label: 'Completed',
    labelZh: '已完成',
    color: 'text-blue-500',
    dotColor: 'bg-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  ARCHIVED: {
    label: 'Archived',
    labelZh: '已归档',
    color: 'text-zinc-400',
    dotColor: 'bg-zinc-400',
    bgColor: 'bg-zinc-500/10',
    borderColor: 'border-zinc-500/30',
  },
}

// ─── 项目预设颜色 ───────────────────────────────────────

export const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f59e0b', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#64748b', '#78716c',
]

// ─── 项目预设图标 ───────────────────────────────────────

export const PROJECT_ICONS = [
  '📁', '🚀', '💡', '🎯', '🔧', '📝', '🎨', '📊',
  '🔍', '🧪', '⚙️', '🌟', '📦', '🏗️', '🛠️', '📱',
]
