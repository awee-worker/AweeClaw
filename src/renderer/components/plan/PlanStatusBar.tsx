/**
 * 计划任务状态栏（会话窗口顶部）
 *
 * 常驻展示当前工作区所有任务计划，支持多个计划并存；点击任一计划从右侧打开任务面板。
 *
 * 之所以订阅 store.plans 而不是绑定某条助手消息：计划是跨会话、长期存在的实体，
 * 会话切换、上下文压缩、消息裁剪都不应让入口消失。状态栏是计划在界面上的唯一常驻
 * 入口，右侧面板才是它的详情视图。
 *
 * 计划数量不定，chip 在固定宽度内横向滚动，不挤压对话区也不换行撑高状态栏。
 */
import { memo, useMemo } from 'react'
import { ListTodo, Loader2, CheckCircle2, Pause, XCircle, Clock, X } from 'lucide-react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useStore } from '@store'
import type { TaskPlan, PlanStatus } from '@intelligence/planner/providerTypes'
import type { Language } from '@renderer/i18n'
import { useConfirmDialog } from '@components/foundation'
import { confirmAndDeletePlan } from './planPanelActions'

/** 处于「进行中」的计划状态：用于运行指示点与芯片状态图标 */
const ACTIVE_STATUSES: PlanStatus[] = ['executing', 'pausing', 'stopping']

const STATUS_TEXT: Partial<Record<PlanStatus, { zh: string; en: string }>> = {
  draft: { zh: '草稿', en: 'Draft' },
  approved: { zh: '待执行', en: 'Ready' },
  executing: { zh: '执行中', en: 'Running' },
  pausing: { zh: '暂停中', en: 'Pausing' },
  paused: { zh: '已暂停', en: 'Paused' },
  stopping: { zh: '停止中', en: 'Stopping' },
  stopped: { zh: '已停止', en: 'Stopped' },
  completed: { zh: '已完成', en: 'Done' },
  failed: { zh: '失败', en: 'Failed' },
}

function StatusIcon({ status }: { status: PlanStatus }) {
  if (ACTIVE_STATUSES.includes(status)) {
    return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
  }
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
    case 'paused':
      return <Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" />
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
    case 'stopped':
      return <XCircle className="w-3.5 h-3.5 text-text-muted shrink-0" />
    default:
      return <Clock className="w-3.5 h-3.5 text-text-muted shrink-0" />
  }
}

const PlanChip = memo(function PlanChip({
  plan,
  isActive,
  language,
  onOpen,
  onDelete,
}: {
  plan: TaskPlan
  isActive: boolean
  language: Language
  onOpen: () => void
  onDelete: () => void
}) {
  const total = plan.tasks.length
  const completed = plan.tasks.filter((t) => t.status === 'completed').length
  const statusText = STATUS_TEXT[plan.status]?.[language === 'zh' ? 'zh' : 'en'] ?? plan.status
  const isRunning = ACTIVE_STATUSES.includes(plan.status)

  return (
    <div
      className={`group flex items-center gap-1 shrink-0 max-w-[230px] rounded-lg border pl-2.5 pr-1 py-1 transition-colors ${
        isActive
          ? 'border-accent/40 bg-accent/10 text-text-primary'
          : 'border-border/40 bg-surface/40 hover:bg-surface-hover text-text-secondary hover:text-text-primary'
      }`}
    >
      <button
        onClick={onOpen}
        title={`${plan.name} · ${statusText}`}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
      >
        <StatusIcon status={plan.status} />
        <span className="text-xs font-medium truncate">{plan.name}</span>
        {total > 0 && (
          <span className="text-[11px] text-text-muted shrink-0 tabular-nums">
            {completed}/{total}
          </span>
        )}
        {isRunning && (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
          </span>
        )}
      </button>
      <button
        onClick={onDelete}
        disabled={isRunning}
        title={
          isRunning
            ? (language === 'zh' ? '当前任务正在执行中，不能删除' : 'Task is running and cannot be deleted')
            : (language === 'zh' ? '删除任务' : 'Delete task')
        }
        className={`p-0.5 rounded transition-all shrink-0 ${
          isRunning
            ? 'text-text-muted opacity-40 cursor-not-allowed'
            : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10'
        }`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
})

export const PlanStatusBar = memo(function PlanStatusBar() {
  const plans = useAgentStore((s) => s.plans)
  const planPanelPlanId = useStore((s) => s.planPanelPlanId)
  const openPlanPanel = useStore((s) => s.openPlanPanel)
  const language = useStore((s) => s.language) as Language
  const isZh = language === 'zh'
  // 删除前的二次确认弹窗（组件内自渲染，无需全局 Provider）
  const { confirm, DialogComponent } = useConfirmDialog()

  // 排序：进行中优先，其次暂停/待执行，终态靠后；同档按更新时间倒序
  const sorted = useMemo(() => {
    const weight: Partial<Record<PlanStatus, number>> = {
      executing: 0,
      pausing: 0,
      stopping: 0,
      paused: 1,
      draft: 2,
      approved: 2,
      stopped: 3,
      completed: 4,
      failed: 5,
    }
    return [...plans].sort((a, b) => {
      const diff = (weight[a.status] ?? 6) - (weight[b.status] ?? 6)
      return diff !== 0 ? diff : (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }, [plans])

  if (sorted.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 bg-surface/20 shrink-0">
        <ListTodo className="w-3.5 h-3.5 text-text-muted shrink-0" />
        {/* 计划数量不定：横向滚动，宽度随会话面板自适应，不换行撑高 */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
          {sorted.map((plan) => (
            <PlanChip
              key={plan.id}
              plan={plan}
              isActive={plan.id === planPanelPlanId}
              language={language}
              onOpen={() => openPlanPanel(plan.id)}
              onDelete={() => confirmAndDeletePlan(plan.id, confirm, isZh)}
            />
          ))}
        </div>
      </div>
      {DialogComponent}
    </>
  )
})
