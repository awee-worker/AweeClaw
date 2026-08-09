/**
 * ProjectExecutionSummary — 项目执行概览卡片
 *
 * 嵌入 ProjectOverview 中，展示项目级别的执行状态概览：
 * - 已执行任务数 / 总任务数
 * - 进行中 / 已完成 / 未开始 分布
 * - 快速跳转到执行 Tab 的按钮
 *
 * 数据来源：tasks 数组中的 threadId 字段（有 threadId 表示已启动过执行）
 */
import { Play, MessageSquare, CheckCircle2, Circle, ArrowRight, Activity } from 'lucide-react'
import type { TaskItem } from '../tasks/types'

interface ProjectExecutionSummaryProps {
  tasks: TaskItem[]
  isZh: boolean
  /** 跳转到执行 Tab */
  onNavigateToExecution: () => void
}

export function ProjectExecutionSummary({
  tasks, isZh, onNavigateToExecution,
}: ProjectExecutionSummaryProps) {
  const total = tasks.length
  const executed = tasks.filter(t => !!t.threadId).length
  const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length
  const done = tasks.filter(t => t.status === 'DONE').length
  const notStarted = total - executed

  // 执行覆盖率：已启动执行的任务占比
  const executionRate = total > 0 ? executed / total : 0

  if (total === 0) return null

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
        {isZh ? '执行概览' : 'Execution Overview'}
      </h3>

      <div className="p-4 rounded-lg border border-border/30 bg-surface/30">
        {/* 执行覆盖率进度条 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-accent" />
            <span className="text-[13px] font-medium text-text-primary">
              {isZh ? '执行覆盖' : 'Execution Coverage'}
            </span>
          </div>
          <span className="text-[13px] font-medium text-text-primary">
            {executed}/{total}
          </span>
        </div>
        <div className="h-2 rounded-full bg-surface-hover/50 overflow-hidden mb-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-all"
            style={{ width: `${executionRate * 100}%` }}
          />
        </div>

        {/* 状态分布 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <StatusChip
            icon={<Circle className="w-3 h-3" />}
            value={notStarted}
            label={isZh ? '未开始' : 'Not Started'}
            color="text-slate-500"
            bg="bg-slate-500/10"
          />
          <StatusChip
            icon={<MessageSquare className="w-3 h-3" />}
            value={inProgress}
            label={isZh ? '进行中' : 'In Progress'}
            color="text-blue-500"
            bg="bg-blue-500/10"
          />
          <StatusChip
            icon={<CheckCircle2 className="w-3 h-3" />}
            value={done}
            label={isZh ? '已完成' : 'Done'}
            color="text-green-500"
            bg="bg-green-500/10"
          />
        </div>

        {/* 跳转按钮 */}
        <button
          onClick={onNavigateToExecution}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-[13px] font-medium border border-accent/20"
        >
          <Play className="w-3.5 h-3.5" />
          {isZh ? '前往执行' : 'Go to Execution'}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── 状态芯片 ───────────────────────────────────────────

function StatusChip({
  icon, value, label, color, bg,
}: {
  icon: React.ReactNode
  value: number
  label: string
  color: string
  bg: string
}) {
  return (
    <div className={`p-2 rounded-md ${bg} border border-border/20 text-center`}>
      <div className={`flex items-center justify-center gap-1 ${color} mb-0.5`}>
        {icon}
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <div className="text-[16px] font-bold text-text-primary">{value}</div>
    </div>
  )
}
