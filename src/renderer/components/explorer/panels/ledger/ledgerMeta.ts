/**
 * 任务中心展示元数据
 *
 * 状态、来源、风险三组标签的颜色、图标与中英文文案只在这里定义一份：
 * 概览卡、筛选栏、列表行、详情面板都从这里取，避免同一个状态在不同位置
 * 长出不同颜色，也免得改一处忘一处。
 *
 * @module explorer/panels/ledger/ledgerMeta
 */

import {
  Ban,
  CheckCircle2,
  Clock,
  Hand,
  Loader2,
  ShieldAlert,
  Sparkles,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { LedgerTaskView } from '@renderer/types/electronBridge'

export type TaskStatus = LedgerTaskView['status']
export type TaskOrigin = LedgerTaskView['origin']
export type TaskRisk = LedgerTaskView['risk']

/**
 * 列表与筛选栏共用的固定顺序
 *
 * 先看要处理的（执行中 / 待审批 / 等待执行），再看已成历史的，
 * 保证无论数据何时写入，用户扫读的顺序都稳定。
 */
export const STATUS_ORDER: TaskStatus[] = [
  'running',
  'pending_approval',
  'queued',
  'completed',
  'failed',
  'cancelled',
]

/** 尚未进入终态的状态：用于「进行中」统计与筛选 */
export const ACTIVE_STATUSES: TaskStatus[] = ['running', 'pending_approval', 'queued']

export interface StatusMeta {
  dot: string
  text: string
  /** 徽标底色，详情与卡片用 */
  chip: string
  icon: LucideIcon
  labelZh: string
  label: string
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending_approval: {
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    chip: 'border-amber-400/40 bg-amber-400/10 text-amber-500',
    icon: ShieldAlert,
    labelZh: '待审批',
    label: 'Pending approval',
  },
  queued: {
    dot: 'bg-slate-400',
    text: 'text-slate-400',
    chip: 'border-border/60 bg-surface/60 text-text-secondary',
    icon: Clock,
    labelZh: '等待执行',
    label: 'Queued',
  },
  running: {
    dot: 'bg-blue-400',
    text: 'text-blue-400',
    chip: 'border-blue-400/40 bg-blue-400/10 text-blue-500',
    icon: Loader2,
    labelZh: '执行中',
    label: 'Running',
  },
  completed: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    chip: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500',
    icon: CheckCircle2,
    labelZh: '已完成',
    label: 'Completed',
  },
  failed: {
    dot: 'bg-red-400',
    text: 'text-red-400',
    chip: 'border-red-400/40 bg-red-400/10 text-red-500',
    icon: XCircle,
    labelZh: '失败',
    label: 'Failed',
  },
  cancelled: {
    dot: 'bg-slate-500',
    text: 'text-slate-500',
    chip: 'border-border/50 bg-surface/40 text-text-muted',
    icon: Ban,
    labelZh: '已取消',
    label: 'Cancelled',
  },
}

export const ORIGIN_ORDER: TaskOrigin[] = ['trigger', 'cron', 'manual', 'proactive']

export const ORIGIN_META: Record<TaskOrigin, { labelZh: string; label: string; icon: LucideIcon }> = {
  trigger: { labelZh: '事件触发', label: 'Event', icon: Zap },
  cron: { labelZh: '定时触发', label: 'Scheduled', icon: Clock },
  manual: { labelZh: '手动创建', label: 'Manual', icon: Hand },
  proactive: { labelZh: '主动建议', label: 'Proactive', icon: Sparkles },
}

export const RISK_META: Record<TaskRisk, { labelZh: string; label: string; chip: string }> = {
  low: {
    labelZh: '低风险',
    label: 'Low risk',
    chip: 'border-emerald-400/30 bg-emerald-400/5 text-emerald-500',
  },
  medium: {
    labelZh: '中风险',
    label: 'Medium risk',
    chip: 'border-amber-400/30 bg-amber-400/5 text-amber-500',
  },
  high: {
    labelZh: '高风险',
    label: 'High risk',
    chip: 'border-red-400/30 bg-red-400/5 text-red-500',
  },
}

/** 绝对时间：详情面板与悬浮提示用 */
export function formatTime(ts: number | null): string {
  if (!ts || ts <= 0) return '-'
  return new Date(ts).toLocaleString()
}

/** 列表用的短时间：同年省略年份，读起来更省地方 */
export function formatShortTime(ts: number): string {
  if (!ts || ts <= 0) return '-'
  const date = new Date(ts)
  const now = new Date()
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return date.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${date.getFullYear()}-${md}`
}

/** 相对时间：事件流里「多久以前」比绝对时间更容易比较先后 */
export function formatRelative(ts: number, isZh: boolean): string {
  if (!ts || ts <= 0) return '-'
  const diff = Date.now() - ts
  if (diff < 0) return formatShortTime(ts)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return isZh ? '刚刚' : 'just now'
  if (diff < hour) {
    const n = Math.floor(diff / minute)
    return isZh ? `${n} 分钟前` : `${n}m ago`
  }
  if (diff < day) {
    const n = Math.floor(diff / hour)
    return isZh ? `${n} 小时前` : `${n}h ago`
  }
  if (diff < 7 * day) {
    const n = Math.floor(diff / day)
    return isZh ? `${n} 天前` : `${n}d ago`
  }
  return formatShortTime(ts)
}

/** 执行耗时；running 状态下传 to = null，按当前时刻实时算 */
export function formatDuration(from: number, to: number | null): string {
  const end = to ?? Date.now()
  const ms = Math.max(0, end - from)
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hour = Math.floor(min / 60)
  return `${hour}h ${min % 60}m`
}

/** 终态任务的耗时；未结束返回 null，不编造一个「正在跑」的假数字 */
export function taskDuration(task: LedgerTaskView): number | null {
  return task.finishedAt && task.finishedAt > 0 ? task.finishedAt - task.createdAt : null
}
