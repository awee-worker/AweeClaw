import { memo, useMemo, useState, useCallback } from 'react'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { useStore } from '@store'
import { globalConfirm } from '@renderer/components/common/ConfirmDialog'
import {
    PlayCircle,
    CheckCircle2,
    Clock,
    Pause,
    XCircle,
    ChevronRight,
    FileText,
    Trash2,
} from 'lucide-react'
import type { TaskPlan, PlanStatus } from '@renderer/agent/plan/types'

interface PlanListContentProps {
    language?: 'en' | 'zh'
    onPlanSelect?: () => void
}

const DELETABLE_STATUSES: PlanStatus[] = ['stopped', 'completed', 'failed']

function StatusIcon({ status }: { status: PlanStatus }) {
    switch (status) {
        case 'executing':
        case 'pausing':
        case 'stopping':
            return <PlayCircle className="w-4 h-4 text-accent animate-pulse" />
        case 'completed':
            return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        case 'paused':
            return <Pause className="w-4 h-4 text-amber-400" />
        case 'failed':
            return <XCircle className="w-4 h-4 text-red-400" />
        case 'stopped':
            return <XCircle className="w-4 h-4 text-text-muted" />
        default:
            return <Clock className="w-4 h-4 text-text-muted" />
    }
}

function getStatusText(status: PlanStatus, language: 'en' | 'zh'): string {
    const texts: Partial<Record<PlanStatus, { en: string; zh: string }>> = {
        draft: { en: 'Draft', zh: '草稿' },
        approved: { en: 'Approved', zh: '已批准' },
        executing: { en: 'Executing', zh: '执行中' },
        pausing: { en: 'Pausing', zh: '暂停中' },
        paused: { en: 'Paused', zh: '已暂停' },
        stopping: { en: 'Stopping', zh: '停止中' },
        stopped: { en: 'Stopped', zh: '已停止' },
        completed: { en: 'Completed', zh: '已完成' },
        failed: { en: 'Failed', zh: '失败' },
    }
    return texts[status]?.[language] || status
}

function getTaskProgress(plan: TaskPlan): { completed: number; total: number } {
    const total = plan.tasks.length
    const completed = plan.tasks.filter(t => t.status === 'completed').length
    return { completed, total }
}

const PlanItem = memo(function PlanItem({
    plan,
    isActive,
    language,
    onClick,
    onDelete,
}: {
    plan: TaskPlan
    isActive: boolean
    language: 'en' | 'zh'
    onClick: () => void
    onDelete?: () => void
}) {
    const { completed, total } = getTaskProgress(plan)
    const progressPercent = total > 0 ? (completed / total) * 100 : 0
    const isDeletable = DELETABLE_STATUSES.includes(plan.status)

    const timeAgo = useMemo(() => {
        const diff = Date.now() - plan.updatedAt
        const minutes = Math.floor(diff / 1000 / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return language === 'zh' ? `${days}天前` : `${days}d ago`
        if (hours > 0) return language === 'zh' ? `${hours}小时前` : `${hours}h ago`
        if (minutes > 0) return language === 'zh' ? `${minutes}分钟前` : `${minutes}m ago`
        return language === 'zh' ? '刚刚' : 'Just now'
    }, [plan.updatedAt, language])

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        onDelete?.()
    }, [onDelete])

    return (
        <div
            onClick={onClick}
            className={`
                w-full p-3 text-left rounded-xl transition-all group cursor-pointer
                ${isActive
                    ? 'bg-accent/10 border border-accent/30'
                    : 'hover:bg-white/5 border border-transparent hover:border-white/10'
                }
            `}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <StatusIcon status={plan.status} />
                    <div className="min-w-0">
                        <div className="font-medium text-sm text-text-primary truncate">
                            {plan.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-text-muted">
                                {getStatusText(plan.status, language)}
                            </span>
                            <span className="text-[11px] text-text-muted/85">•</span>
                            <span className="text-[11px] text-text-muted/85">
                                {timeAgo}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-1">
                    {isDeletable && (
                        <button
                            onClick={handleDelete}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/15 text-text-muted hover:text-red-400 transition-all"
                            title={language === 'zh' ? '删除计划' : 'Delete plan'}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-text-muted/75 group-hover:text-text-muted transition-colors" />
                </div>
            </div>

            {total > 0 && (
                <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-text-muted">
                            {completed}/{total} {language === 'zh' ? '任务' : 'tasks'}
                        </span>
                        <span className="text-text-muted font-mono">
                            {Math.round(progressPercent)}%
                        </span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${progressPercent === 100
                                ? 'bg-emerald-400'
                                : 'bg-accent'
                                }`}
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
})

export default memo(function PlanListContent({
    language = 'zh',
    onPlanSelect
}: PlanListContentProps) {
    const plans = useAgentStore(state => state.plans)
    const activePlanId = useAgentStore(state => state.activePlanId)
    const setActivePlan = useAgentStore(state => state.setActivePlan)
    const deletePlan = useAgentStore(state => state.deletePlan)
    const openFile = useStore(state => state.openFile)
    const workspacePath = useStore(state => state.workspacePath)

    const sortedPlans = useMemo(() => {
        const priorityMap: Partial<Record<PlanStatus, number>> = {
            executing: 0,
            pausing: 0,
            stopping: 0,
            paused: 1,
            draft: 2,
            approved: 2,
            stopped: 2,
            completed: 3,
            failed: 4,
        }
        return [...plans].sort((a, b) => {
            const pA = priorityMap[a.status] ?? 5
            const pB = priorityMap[b.status] ?? 5
            if (pA !== pB) return pA - pB
            return b.updatedAt - a.updatedAt
        })
    }, [plans])

    const handlePlanClick = (plan: TaskPlan) => {
        setActivePlan(plan.id)
        if (workspacePath) {
            const jsonPath = `${workspacePath}/.aweeclaw/plan/${plan.id}.json`
            openFile(jsonPath, JSON.stringify(plan, null, 2))
        }
        onPlanSelect?.()
    }

    const handleDeletePlan = useCallback(async (plan: TaskPlan) => {
        deletePlan(plan.id)
        if (workspacePath) {
            try {
                const planPath = `${workspacePath}/.aweeclaw/plan/${plan.id}.json`
                const { api } = await import('@/renderer/services/electronAPI')
                await api.file.delete(planPath)
            } catch {}
        }
    }, [deletePlan, workspacePath])

    if (plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted py-8">
                <FileText className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">
                    {language === 'zh' ? '暂无计划' : 'No Plans Yet'}
                </p>
                <p className="text-xs text-text-muted/85 mt-1 text-center px-4">
                    {language === 'zh'
                        ? '使用 Plan 模式创建任务计划'
                        : 'Use Plan mode to create task plans'
                    }
                </p>
            </div>
        )
    }

    return (
        <div className="p-2 space-y-1.5">
            {sortedPlans.map(plan => (
                <PlanItem
                    key={plan.id}
                    plan={plan}
                    isActive={plan.id === activePlanId}
                    language={language}
                    onClick={() => handlePlanClick(plan)}
                    onDelete={() => handleDeletePlan(plan)}
                />
            ))}
        </div>
    )
})
