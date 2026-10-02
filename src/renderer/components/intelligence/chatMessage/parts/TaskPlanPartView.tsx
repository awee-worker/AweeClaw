/**
 * 任务规划 Part 视图
 *
 * 计划看板已经移到会话顶部状态栏 + 右侧面板，会话流里不再内嵌看板。
 * 这里只保留一行轻量确认，让用户在对话里能明确看到「计划已创建、去哪里审核」，
 * 否则工具跑完后这段对话是空白的，用户不知道发生了什么。
 *
 * 计划被删除后这条消息仍留在历史里，此时给出明确的失效提示，
 * 而不是留一个点了没反应的按钮。
 */
import { ListTodo, ArrowRight, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import type { Language } from '@renderer/i18n'

export function TaskPlanPartView({ planId }: { planId: string }) {
  const language = useStore((s) => s.language) as Language
  const openPlanPanel = useStore((s) => s.openPlanPanel)
  const planExists = useAgentStore((s) => s.plans.some((p) => p.id === planId))
  const isZh = language === 'zh'

  // 计划已删除：消息还在会话历史里，标记为失效而非留一个空按钮
  if (!planExists) {
    return (
      <div className="flex items-center gap-2 my-1.5 px-3 py-2 rounded-lg border border-border/40 bg-surface/30 max-w-full opacity-60">
        <Trash2 className="w-4 h-4 text-text-muted shrink-0" />
        <span className="text-xs text-text-muted truncate">
          {isZh ? '该任务已删除' : 'This task was deleted'}
        </span>
      </div>
    )
  }

  return (
    <button
      onClick={() => openPlanPanel(planId)}
      className="group flex items-center gap-2 my-1.5 px-3 py-2 rounded-lg border border-accent/25 bg-accent/5 hover:bg-accent/10 text-left transition-colors max-w-full"
      title={isZh ? '打开任务面板' : 'Open task panel'}
    >
      <ListTodo className="w-4 h-4 text-accent shrink-0" />
      <span className="text-xs text-text-primary truncate">
        {isZh ? '任务已创建，请在任务面板审计并执行' : 'Plan created. Review and start it in the task panel.'}
      </span>
      <ArrowRight className="w-3.5 h-3.5 text-accent shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
