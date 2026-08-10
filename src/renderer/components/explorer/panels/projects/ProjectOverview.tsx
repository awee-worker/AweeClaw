/**
 * ProjectOverview — 项目概览 Tab
 *
 * 展示项目整体信息：
 * - 目标、描述
 * - 任务统计（完成率、各状态数量）
 * - 执行概览（执行覆盖率、状态分布、跳转入口）
 * - 自动化规则数
 * - 关联的工作区、知识库、对话
 */
import { CheckCircle2, Circle, Clock, AlertCircle, Zap, Target, Package, FileCode, FolderOpen } from 'lucide-react'
import type { ProjectItem, TaskItem, AutomationRule } from '../tasks/types'
import { ProjectExecutionSummary } from './ProjectExecutionSummary'
import { extractExecutionResult, type DeliverableItem } from './taskQuality'

interface ProjectOverviewProps {
  project: ProjectItem
  tasks: TaskItem[]
  rules: AutomationRule[]
  isZh: boolean
  /** 跳转到执行 Tab */
  onNavigateToExecution?: () => void
}

export function ProjectOverview({ project, tasks, rules, isZh, onNavigateToExecution }: ProjectOverviewProps) {
  const totalTasks = tasks.length
  const doneTasks = tasks.filter(t => t.status === 'DONE').length
  const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length
  const blocked = tasks.filter(t => t.status === 'BLOCKED').length
  const todo = tasks.filter(t => t.status === 'TODO').length
  const completionRate = totalTasks > 0 ? doneTasks / totalTasks : 0

  // 项目成果汇总：从已完成任务的 metadata 中提取结构化结果
  const doneTasksWithResults = tasks
    .filter(t => t.status === 'DONE')
    .map(t => ({ task: t, result: extractExecutionResult(t.metadata) }))
    .filter(item => item.result !== null)
  const allDeliverables: Array<DeliverableItem & { taskTitle: string }> = []
  for (const { task, result } of doneTasksWithResults) {
    if (result) {
      for (const d of result.deliverables) {
        allDeliverables.push({ ...d, taskTitle: task.title })
      }
    }
  }
  const hasResults = doneTasksWithResults.length > 0

  return (
    <div className="p-5 max-w-3xl space-y-5">
      {/* 目标 */}
      {project.goal && (
        <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent mb-1.5">
            <Target className="w-3.5 h-3.5" />
            {isZh ? '项目目标' : 'Project Goal'}
          </div>
          <p className="text-[14px] text-text-primary leading-relaxed">{project.goal}</p>
        </div>
      )}

      {/* 描述 */}
      {project.description && (
        <div>
          <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            {isZh ? '描述' : 'Description'}
          </h3>
          <p className="text-[14px] text-text-secondary leading-relaxed whitespace-pre-wrap">{project.description}</p>
        </div>
      )}

      {/* 项目目录 */}
      {project.workspacePaths.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            {isZh ? '项目目录' : 'Project Directory'}
          </h3>
          <div className="space-y-1">
            {project.workspacePaths.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface/40 border border-border/20 text-[12px] text-text-secondary font-mono"
                title={p}
              >
                <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                <span className="truncate">{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div>
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '任务统计' : 'Task Statistics'}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Circle className="w-4 h-4" />} value={todo} label={isZh ? '待办' : 'To Do'} color="text-slate-500" bg="bg-slate-500/10" />
          <StatCard icon={<Clock className="w-4 h-4" />} value={inProgress} label={isZh ? '进行中' : 'In Progress'} color="text-blue-500" bg="bg-blue-500/10" />
          <StatCard icon={<AlertCircle className="w-4 h-4" />} value={blocked} label={isZh ? '阻塞' : 'Blocked'} color="text-red-500" bg="bg-red-500/10" />
          <StatCard icon={<CheckCircle2 className="w-4 h-4" />} value={doneTasks} label={isZh ? '已完成' : 'Done'} color="text-green-500" bg="bg-green-500/10" />
        </div>
      </div>

      {/* 完成进度 */}
      {totalTasks > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text-muted uppercase tracking-wider">
              {isZh ? '完成进度' : 'Completion'}
            </span>
            <span className="text-[13px] font-medium text-text-primary">
              {Math.round(completionRate * 100)}% ({doneTasks}/{totalTasks})
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-hover/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-all"
              style={{ width: `${completionRate * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 项目成果汇总（从已完成任务的结构化结果中汇总） */}
      {hasResults && (
        <div>
          <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
            {isZh ? '项目成果' : 'Project Deliverables'}
          </h3>
          <div className="space-y-2">
            {/* 已完成任务摘要 */}
            {doneTasksWithResults.map(({ task, result }) => (
              <div key={task.id} className="p-3 rounded-lg bg-surface/40 border border-border/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  <span className="text-[13px] font-medium text-text-primary truncate">{task.title}</span>
                </div>
                {result?.summary && (
                  <p className="text-[12px] text-text-secondary leading-relaxed mb-1.5">{result.summary}</p>
                )}
                {result && result.deliverables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {result.deliverables.map((d, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 text-accent text-[11px] font-mono"
                        title={d.description}
                      >
                        <FileCode className="w-3 h-3" />
                        {d.path.split('/').pop() || d.path}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 全部产出文件统计 */}
          {allDeliverables.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
              <Package className="w-3.5 h-3.5" />
              <span>{isZh ? `共 ${allDeliverables.length} 个产出文件` : `${allDeliverables.length} deliverable files`}</span>
            </div>
          )}
        </div>
      )}

      {/* 自动化规则 */}
      <div>
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          {isZh ? '自动化规则' : 'Automation Rules'}
        </h3>
        <div className="flex items-center gap-2 text-[14px] text-text-secondary">
          <Zap className="w-4 h-4 text-amber-500" />
          <span>{rules.length} {isZh ? '条规则' : 'rules'}</span>
          <span className="text-text-muted">({rules.filter(r => r.enabled).length} {isZh ? '启用' : 'active'})</span>
        </div>
      </div>

      {/* 执行概览 */}
      {onNavigateToExecution && (
        <ProjectExecutionSummary
          tasks={tasks}
          isZh={isZh}
          onNavigateToExecution={onNavigateToExecution}
        />
      )}

      {/* 关联资源 */}
      {(project.workspacePaths.length > 0 || project.knowledgeBaseIds.length > 0 || project.threadIds.length > 0) && (
        <div>
          <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            {isZh ? '关联资源' : 'Linked Resources'}
          </h3>
          <div className="space-y-1 text-[13px] text-text-secondary">
            {project.workspacePaths.length > 0 && (
              <div>{isZh ? '工作区' : 'Workspaces'}: {project.workspacePaths.length}</div>
            )}
            {project.knowledgeBaseIds.length > 0 && (
              <div>{isZh ? '知识库' : 'Knowledge bases'}: {project.knowledgeBaseIds.length}</div>
            )}
            {project.threadIds.length > 0 && (
              <div>{isZh ? '对话' : 'Threads'}: {project.threadIds.length}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  icon, value, label, color, bg,
}: {
  icon: React.ReactNode
  value: number
  label: string
  color: string
  bg: string
}) {
  return (
    <div className={`p-3 rounded-lg ${bg} border border-border/20`}>
      <div className={`flex items-center gap-1.5 ${color} mb-1`}>
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className="text-[20px] font-bold text-text-primary">{value}</div>
    </div>
  )
}
