/**
 * 计划任务面板（右侧抽屉）
 *
 * 从窗口右侧滑出的固定宽度看板（需求文档 + 任务列表 + 执行控制）。
 * 直接复用 ExecutionBoard，保证与「打开 plan JSON 文件」时的 UI 交互完全一致。
 *
 * 宽度固定 1000px 且用 fixed 定位：挂载在应用根层而非会话列内，因此不受会话面板
 * 宽度影响，开着编辑器时也能完整展开看板的左右双栏。
 *
 * 计划执行跑在独立的任务线程里，与当前对话互不干扰；面板顶部常驻提示说明这一点，
 * 消除「我在跟谁说话、发出去会不会插进正在跑的计划」的困惑。
 */
import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ListTodo, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { ExecutionBoard } from './ExecutionBoard'
import { useConfirmDialog } from '@components/foundation'
import { confirmAndDeletePlan } from './planPanelActions'
import type { PlanStatus } from '@intelligence/planner/providerTypes'

/** 处于「进行中」的计划状态：面板头部据此显示后台执行提示 */
const ACTIVE_STATUSES: PlanStatus[] = ['executing', 'pausing', 'stopping']

export const PlanPanelDrawer = memo(function PlanPanelDrawer() {
  const { planPanelPlanId, closePlanPanel, language } = useStore(
    useShallow((s) => ({
      planPanelPlanId: s.planPanelPlanId,
      closePlanPanel: s.closePlanPanel,
      language: s.language,
    })),
  )

  // 面板只持有 planId，运行时从 store 读取计划：状态变化（执行中/完成/失败）自动反映
  const plan = useAgentStore((s) => (planPanelPlanId ? s.plans.find((p) => p.id === planPanelPlanId) : undefined))

  const isZh = language === 'zh'
  const isActive = plan ? ACTIVE_STATUSES.includes(plan.status) : false

  // 删除前的二次确认弹窗（组件内自渲染，无需全局 Provider）
  const { confirm, DialogComponent } = useConfirmDialog()

  return (
    <>
    <AnimatePresence>
      {/* 点击面板外区域关闭：遮罩在面板之下，面板 z 更高，内部点击不会落到遮罩上 */}
      {planPanelPlanId && plan && (
        <motion.div
          key="plan-panel-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-30 bg-black/10"
          onClick={closePlanPanel}
        />
      )}
      {planPanelPlanId && plan && (
        <motion.div
          key="plan-panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
          className="fixed inset-y-0 right-0 z-40 flex w-[1000px] max-w-[100vw] flex-col border-l border-border bg-background shadow-2xl"
        >
          {/* 头部：计划名 + 后台执行提示 + 删除 / 收起 */}
          <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
            <ListTodo className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-medium text-text-primary truncate">{plan.name}</span>
            {isActive && (
              <span className="flex items-center gap-1.5 text-[11px] text-blue-400 shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
                </span>
                {isZh ? '后台执行中 · 不影响当前对话' : 'Running in background · chat unaffected'}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => confirmAndDeletePlan(plan.id, confirm, isZh)}
              disabled={isActive}
              className={`p-1.5 rounded-md transition-colors ${
                isActive
                  ? 'text-text-muted opacity-40 cursor-not-allowed'
                  : 'text-text-muted hover:text-red-400 hover:bg-red-500/10'
              }`}
              title={
                isActive
                  ? (isZh ? '当前任务正在执行中，不能删除' : 'Task is running and cannot be deleted')
                  : (isZh ? '删除任务' : 'Delete task')
              }
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={closePlanPanel}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={isZh ? '收起' : 'Collapse'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 看板内容：复用 ExecutionBoard，交互与打开 plan JSON 文件时一致 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ExecutionBoard planId={planPanelPlanId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    {DialogComponent}
    </>
  )
})
