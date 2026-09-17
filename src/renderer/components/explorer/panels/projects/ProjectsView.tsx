/**
 * ProjectsView — 项目管理工作台（宽屏模式）
 *
 * 布局结构：
 * ┌────────────┬──────────────────────────────────────┐
 * │  项目列表   │  项目详情（多 Tab）                    │
 * │  (左侧)    │  概览 | 任务 | 自动化 | 设置           │
 * └────────────┴──────────────────────────────────────┘
 *
 * 左侧列表展示所有项目卡片（图标、名称、状态、完成率）
 * 右侧详情区按 Tab 切换不同视角
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Loader2, AlertCircle, FolderPlus, ArrowLeft,
} from 'lucide-react'
import { useStore } from '@store'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { projectsApi, tasksApi, automationApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import { localAttachmentsService } from '@renderer/adapters/localAttachmentsService'
import type { ProjectItem, TaskItem, AutomationRule, CreateProjectInput, UpdateProjectInput } from '../tasks/types'
import { PROJECT_STATUS_CONFIG } from '../tasks/taskConstants'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectOverview } from './ProjectOverview'
import { ProjectTasksTab } from './ProjectTasksTab'
import { ProjectAttachmentsPanel } from './ProjectAttachmentsPanel'
import { ProjectExecutionTab } from './ProjectExecutionTab'
import { ProjectFilesTab } from './ProjectFilesTab'

type DetailTab = 'overview' | 'files' | 'attachments' | 'tasks' | 'execution' | 'automation' | 'settings'

export function ProjectsView() {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  // 项目数量受套餐配额约束（projectsLimit），超限时引导升级
  const { requireQuota } = useFeatureGuard()

  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [showFormDialog, setShowFormDialog] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null)

  // 选中项目的详情数据
  const [projectTasks, setProjectTasks] = useState<TaskItem[]>([])
  const [projectRules, setProjectRules] = useState<AutomationRule[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  // 从任务 Tab 触发的待执行任务 ID（传递给执行 Tab 启动执行）
  const [pendingExecutionTaskId, setPendingExecutionTaskId] = useState<string | null>(null)

  /** 从任务 Tab 点击执行：切换到执行 Tab 并传递待执行任务 ID */
  const handleExecuteTask = useCallback((task: TaskItem) => {
    setPendingExecutionTaskId(task.id)
    setActiveTab('execution')
  }, [])

  // ─── 数据加载 ───────────────────────────────────────

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const data = await projectsApi.list()
      setProjects(data)
      setError(null)
      // 自动选中第一个项目
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id)
      }
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '加载失败' : 'Failed to load'))
    }
    setLoading(false)
  }, [selectedId, isZh])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // 加载选中项目的任务和自动化规则
  useEffect(() => {
    if (!selectedId) {
      setProjectTasks([])
      setProjectRules([])
      return
    }
    setTasksLoading(true)
    Promise.all([
      tasksApi.list({ projectId: selectedId, limit: 500 }).then(r => r.items).catch(() => []),
      automationApi.list({ projectId: selectedId }).catch(() => []),
    ]).then(([tasks, rules]) => {
      setProjectTasks(tasks)
      setProjectRules(rules)
      setTasksLoading(false)
    })
  }, [selectedId])

  // ─── 监听悬浮执行面板的导航事件 ───────────────────────
  // 从 ExecutionStatusDock 点击会话时，自动选中对应项目并切换到执行 Tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId: string }
      if (detail?.projectId) {
        setSelectedId(detail.projectId)
        setActiveTab('execution')
      }
    }
    window.addEventListener('aweeclaw:navigate-to-project-execution', handler)
    return () => window.removeEventListener('aweeclaw:navigate-to-project-execution', handler)
  }, [])

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedId) || null,
    [projects, selectedId],
  )

  // ─── 操作回调 ───────────────────────────────────────

  const handleCreate = useCallback(async () => {
    // 创建前先校验收费配额：不通过则弹升级引导，不打开表单
    if (!(await requireQuota('projectsLimit', projects.length))) return
    setEditingProject(null)
    setShowFormDialog(true)
  }, [requireQuota, projects.length])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await projectsApi.remove(id)
      setProjects(prev => prev.filter(p => p.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '删除失败' : 'Delete failed'))
    }
  }, [selectedId, isZh])

  const handleFormSubmit = useCallback(async (data: {
    name: string
    description?: string
    icon?: string
    color?: string
    status?: ProjectItem['status']
    goal?: string
    tags?: string[]
    dueAt?: string | null
    workspacePaths?: string[]
    attachments?: File[]
  }) => {
    if (editingProject) {
      const updateData: UpdateProjectInput = {
        name: data.name,
        description: data.description ?? null,
        icon: data.icon ?? null,
        color: data.color ?? null,
        status: data.status,
        goal: data.goal ?? null,
        tags: data.tags,
        dueAt: data.dueAt ?? null,
        workspacePaths: data.workspacePaths ?? [],
      }
      try {
        const updated = await projectsApi.update(editingProject.id, updateData)
        setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
        setShowFormDialog(false)
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '更新失败' : 'Update failed'))
      }
    } else {
      // 兜底二次校验：表单可能已打开一段时间，期间项目数可能已达上限
      if (!(await requireQuota('projectsLimit', projects.length))) {
        setShowFormDialog(false)
        return
      }
      const createData: CreateProjectInput = {
        name: data.name,
        description: data.description,
        icon: data.icon,
        color: data.color,
        status: data.status,
        goal: data.goal,
        tags: data.tags,
        dueAt: data.dueAt || undefined,
        workspacePaths: data.workspacePaths ?? [],
      }
      try {
        const created = await projectsApi.create(createData)
        setProjects(prev => [created, ...prev])
        setSelectedId(created.id)
        setShowFormDialog(false)

        // 创建成功后自动上传附件到本地存储（失败不阻断，仅记录错误）
        if (data.attachments && data.attachments.length > 0) {
          try {
            await localAttachmentsService.upload(created.id, data.attachments)
          } catch (e) {
            setError(getApiErrorMessage(e, isZh ? '项目已创建，但附件上传失败，请在附件 Tab 中重试' : 'Project created, but attachment upload failed. Please retry in the Attachments tab'))
          }
        }
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
      }
    }
  }, [editingProject, isZh, requireQuota, projects.length])

  // ─── 渲染 ───────────────────────────────────────────

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* 左侧：项目列表 */}
      <div className="flex-shrink-0 w-72 border-r border-border/40 flex flex-col bg-surface/20">
        {/* 列表头 */}
        <div className="flex-shrink-0 h-14 px-4 flex items-center justify-between border-b border-border/30">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {isZh ? '项目' : 'Projects'}
          </h2>
          <button
            onClick={handleCreate}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {isZh ? '新建' : 'New'}
          </button>
        </div>

        {/* 列表内容 */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <FolderPlus className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[12px]">{isZh ? '暂无项目' : 'No projects yet'}</p>
              <button onClick={handleCreate} className="mt-2 text-[12px] text-accent hover:underline">
                {isZh ? '创建第一个项目' : 'Create one'}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={project.id === selectedId}
                  isZh={isZh}
                  onClick={() => { setSelectedId(project.id); setActiveTab('overview') }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：项目详情 */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedProject ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
            <FolderPlus className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-[14px]">{isZh ? '选择一个项目查看详情' : 'Select a project to view details'}</p>
          </div>
        ) : (
          <>
            {/* 详情头部 */}
            <div className="flex-shrink-0 h-14 px-5 flex items-center justify-between border-b border-border/40 bg-surface/30">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-1 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
                  title={isZh ? '返回列表' : 'Back to list'}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="text-xl flex-shrink-0">{selectedProject.icon || '📁'}</span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-text-primary truncate">{selectedProject.name}</div>
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1 text-[11px] ${PROJECT_STATUS_CONFIG[selectedProject.status as keyof typeof PROJECT_STATUS_CONFIG]?.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${PROJECT_STATUS_CONFIG[selectedProject.status as keyof typeof PROJECT_STATUS_CONFIG]?.dotColor}`} />
                      {isZh ? PROJECT_STATUS_CONFIG[selectedProject.status as keyof typeof PROJECT_STATUS_CONFIG]?.labelZh : PROJECT_STATUS_CONFIG[selectedProject.status as keyof typeof PROJECT_STATUS_CONFIG]?.label}
                    </span>
                    {selectedProject.stats && (
                      <span className="text-[11px] text-text-muted">
                        {selectedProject.stats.doneTasks}/{selectedProject.stats.totalTasks} {isZh ? '任务完成' : 'tasks done'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tab 栏 */}
            <div className="flex-shrink-0 px-5 flex items-center gap-1 border-b border-border/30 bg-surface/10">
              {([
                { id: 'overview', label: isZh ? '概览' : 'Overview' },
                { id: 'files', label: isZh ? '文件' : 'Files' },
                { id: 'attachments', label: isZh ? '附件' : 'Attachments' },
                { id: 'tasks', label: isZh ? '任务' : 'Tasks' },
                { id: 'execution', label: isZh ? '执行' : 'Execution' },
                { id: 'automation', label: isZh ? '自动化' : 'Automation' },
                { id: 'settings', label: isZh ? '设置' : 'Settings' },
              ] as { id: DetailTab; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="mx-5 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="text-[13px] text-red-500">{error}</span>
                </div>
              )}
              {activeTab === 'overview' && (
                <ProjectOverview
                  project={selectedProject}
                  tasks={projectTasks}
                  rules={projectRules}
                  isZh={isZh}
                  onNavigateToExecution={() => setActiveTab('execution')}
                />
              )}
              {activeTab === 'files' && (
                <ProjectFilesTab
                  workspacePaths={selectedProject.workspacePaths}
                  isZh={isZh}
                />
              )}
              {activeTab === 'attachments' && (
                <ProjectAttachmentsPanel projectId={selectedProject.id} isZh={isZh} />
              )}
              {activeTab === 'tasks' && (
                <ProjectTasksTab
                  projectId={selectedProject.id}
                  projectName={selectedProject.name}
                  projectDescription={selectedProject.description}
                  projectGoal={selectedProject.goal}
                  projectTags={selectedProject.tags}
                  tasks={projectTasks}
                  loading={tasksLoading}
                  isZh={isZh}
                  onTasksChange={() => {
                    tasksApi.list({ projectId: selectedProject.id, limit: 500 }).then(r => setProjectTasks(r.items))
                  }}
                  onExecuteTask={handleExecuteTask}
                />
              )}
              {activeTab === 'execution' && (
                <ProjectExecutionTab
                  projectId={selectedProject.id}
                  project={{
                    id: selectedProject.id,
                    name: selectedProject.name,
                    description: selectedProject.description,
                    goal: selectedProject.goal,
                    tags: selectedProject.tags,
                    status: selectedProject.status,
                    workspacePath: selectedProject.workspacePaths?.[0] ?? null,
                  }}
                  tasks={projectTasks}
                  loading={tasksLoading}
                  isZh={isZh}
                  pendingExecutionTaskId={pendingExecutionTaskId}
                  onPendingExecutionConsumed={() => setPendingExecutionTaskId(null)}
                  onTasksChange={() => {
                    tasksApi.list({ projectId: selectedProject.id, limit: 500 }).then(r => setProjectTasks(r.items))
                  }}
                  onProjectChange={loadProjects}
                />
              )}
              {activeTab === 'automation' && (
                <ProjectAutomationTab rules={projectRules} isZh={isZh} loading={tasksLoading} />
              )}
              {activeTab === 'settings' && (
                <ProjectSettingsTab
                  project={selectedProject}
                  isZh={isZh}
                  onEdit={() => { setEditingProject(selectedProject); setShowFormDialog(true) }}
                  onDelete={() => handleDelete(selectedProject.id)}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* 创建/编辑对话框 */}
      {showFormDialog && (
        <ProjectFormDialog
          project={editingProject}
          onSubmit={handleFormSubmit}
          onClose={() => setShowFormDialog(false)}
        />
      )}
    </div>
  )
}

// ─── 项目卡片 ───────────────────────────────────────────

function ProjectCard({
  project, isSelected, isZh, onClick,
}: {
  project: ProjectItem
  isSelected: boolean
  isZh: boolean
  onClick: () => void
}) {
  const statusConfig = PROJECT_STATUS_CONFIG[project.status as keyof typeof PROJECT_STATUS_CONFIG]
  const completionRate = project.stats?.completionRate ?? 0

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-all border ${
        isSelected
          ? 'border-accent/40 bg-accent/5'
          : 'border-border/30 hover:bg-surface-hover/40 hover:border-border/50'
      }`}
    >
      <div className="flex items-start gap-2.5 mb-1.5">
        <span className="text-lg flex-shrink-0">{project.icon || '📁'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text-primary truncate">{project.name}</div>
          {project.description && (
            <div className="text-[12px] text-text-muted truncate">{project.description}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-7">
        <span className={`flex items-center gap-1 text-[11px] ${statusConfig?.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig?.dotColor}`} />
          {isZh ? statusConfig?.labelZh : statusConfig?.label}
        </span>
        {project.stats && project.stats.totalTasks > 0 && (
          <span className="text-[11px] text-text-muted">
            {project.stats.doneTasks}/{project.stats.totalTasks}
          </span>
        )}
      </div>
      {/* 进度条 */}
      {completionRate > 0 && (
        <div className="mt-2 ml-7 h-1 rounded-full bg-surface-hover/50 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${completionRate * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ─── 自动化 Tab ─────────────────────────────────────────

function ProjectAutomationTab({
  rules, isZh, loading,
}: {
  rules: AutomationRule[]
  isZh: boolean
  loading: boolean
}) {
  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-accent animate-spin" /></div>
  }
  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <p className="text-[13px]">{isZh ? '此项目暂无自动化规则' : 'No automation rules for this project'}</p>
        <p className="text-[12px] mt-1 text-text-muted/60">
          {isZh ? '在自动化面板中创建规则时可关联此项目' : 'Create rules in the Automation panel and link them to this project'}
        </p>
      </div>
    )
  }
  return (
    <div className="p-5 space-y-2 max-w-3xl">
      {rules.map(rule => (
        <div key={rule.id} className="p-3 rounded-lg border border-border/30 bg-surface/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-medium text-text-primary">{rule.name}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded ${rule.enabled ? 'bg-green-500/10 text-green-500' : 'bg-zinc-500/10 text-zinc-400'}`}>
              {rule.enabled ? (isZh ? '已启用' : 'Enabled') : (isZh ? '已禁用' : 'Disabled')}
            </span>
          </div>
          {rule.description && (
            <p className="text-[12px] text-text-muted">{rule.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted">
            <span>{isZh ? '触发' : 'Trigger'}: {(rule.triggerConfig as { type?: string })?.type}</span>
            <span>{isZh ? '动作' : 'Action'}: {(rule.actionConfig as { type?: string })?.type}</span>
            <span>{isZh ? '执行' : 'Runs'}: {rule.executionCount}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 设置 Tab ───────────────────────────────────────────

function ProjectSettingsTab({
  project, isZh, onEdit, onDelete,
}: {
  project: ProjectItem
  isZh: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="p-5 max-w-2xl space-y-4">
      <div>
        <h3 className="text-[14px] font-semibold text-text-primary mb-3">{isZh ? '项目信息' : 'Project Info'}</h3>
        <div className="space-y-2 text-[13px]">
          <InfoRow label={isZh ? '名称' : 'Name'} value={project.name} />
          <InfoRow label={isZh ? '描述' : 'Description'} value={project.description || '-'} />
          <InfoRow label={isZh ? '图标' : 'Icon'} value={project.icon || '-'} />
          <InfoRow label={isZh ? '颜色' : 'Color'} value={project.color || '-'} />
          <InfoRow label={isZh ? '目标' : 'Goal'} value={project.goal || '-'} />
          <InfoRow label={isZh ? '标签' : 'Tags'} value={project.tags.join(', ') || '-'} />
          <InfoRow label={isZh ? '创建时间' : 'Created'} value={new Date(project.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')} />
        </div>
      </div>

      <div className="pt-4 border-t border-border/20">
        <h3 className="text-[14px] font-semibold text-text-primary mb-3">{isZh ? '操作' : 'Actions'}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="px-4 py-2 text-[13px] font-medium bg-surface-hover/50 text-text-primary rounded-lg hover:bg-surface-hover transition-colors"
          >
            {isZh ? '编辑项目' : 'Edit Project'}
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-2 text-[13px] font-medium bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"
          >
            {isZh ? '删除项目' : 'Delete Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-text-primary flex-1 break-words">{value}</span>
    </div>
  )
}
