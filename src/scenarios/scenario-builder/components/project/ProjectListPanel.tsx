/**
 * 项目列表面板
 *
 * 显示所有场景项目，支持创建、打开、编辑、删除、在工作区打开目录。
 * 卡片集成校验 / 构建 / 打包 / 安装 / 发布 五大快捷操作，无需切换面板即可完成全流程。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { projectService } from '../../services'
import type { ScenarioProject, ProjectStatus } from '../../types'
import { useI18n } from '@renderer/i18n'
import { api } from '@services/electronBridge'
import { useStore } from '@store'
import type { SidePanel } from '@store/slices'
import { toast } from '@components/foundation/NotificationProvider'
import { directoryCacheService } from '@services/dirCacheAdapter'
import ProjectCreateDialog from './ProjectCreateDialog'
import ProjectEditDialog from './ProjectEditDialog'
import ProjectActionButtons from './ProjectActionButtons'
import OperationErrorDialog from './OperationErrorDialog'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import { useProjectOperations } from '../../hooks/useProjectOperations'
import type { OpErrorInfo } from '../../hooks/useProjectOperations'

const ProjectListPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, select, refresh: refreshSelected } = useSelectedProject()
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const setSelectedFolder = useStore((s) => s.setSelectedFolder)
  const setChatVisible = useStore((s) => s.setChatVisible)
  const [projects, setProjects] = useState<ScenarioProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingProject, setEditingProject] = useState<ScenarioProject | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null)
  // 本地操作（如"在工作区定位"）的失败详情，与 operations.lastError 互补
  const [localError, setLocalError] = useState<OpErrorInfo | null>(null)

  const selectedId = selectedProject?.id ?? null

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await projectService.listProjects()
      setProjects(list)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // 快捷操作 Hook：操作完成后刷新项目列表与选中态
  const operations = useProjectOperations(loadProjects)

  const handleSelectProject = useCallback(
    (project: ScenarioProject) => {
      select(project)
    },
    [select],
  )

  /**
   * 打开项目工作区：选中项目并切换到 project-workspace 面板，
   * 让用户在该项目内进行配置/提示词/工具/脚本/数据库/校验/预览/安装/发布等操作。
   */
  const handleOpenWorkspace = useCallback(
    (project: ScenarioProject, e: React.MouseEvent) => {
      e.stopPropagation()
      select(project)
      // 'project-workspace' 是 scenario-builder 自定义面板 id，不在内置 SidePanel 联合类型中，
      // 与 NavigationRail 一致使用 as 转换（运行时不受限）
      setActiveSidePanel('project-workspace' as SidePanel)
    },
    [select, setActiveSidePanel],
  )

  const handleDelete = useCallback(
    async (project: ScenarioProject, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm(t('builder.project.delete') + '?')) return
      try {
        // 1. 删除磁盘上的项目目录（场景目录）
        if (project.localPath) {
          try {
            await api.file.delete(project.localPath)
          } catch (err) {
            // 目录删除失败不阻断 DB 删除流程，仅记录日志
            console.error('Failed to delete project directory:', err)
          }
        }
        // 2. 归档 DB 记录
        await projectService.deleteProject(project.id)
        // 如果删除的是当前选中项目，清空选中
        if (selectedProject?.id === project.id) {
          select(null)
        }
        await loadProjects()
        // 3. 通知文件资源管理器刷新（项目目录已从磁盘删除）
        if (project.localPath) {
          const parentDir = project.localPath.substring(0, project.localPath.lastIndexOf('/'))
          // 直接失效全局目录缓存（不依赖 FileExplorer 是否挂载）
          directoryCacheService.invalidate(parentDir)
          directoryCacheService.invalidateTree(project.localPath)
          // 派发事件触发已挂载的 FileExplorer 重新加载
          window.dispatchEvent(
            new CustomEvent('workspace:files-changed', {
              detail: {
                affectedPaths: [parentDir],
                deletedPaths: [project.localPath],
              },
            }),
          )
        }
      } catch (err) {
        console.error('Failed to delete project:', err)
      }
    },
    [loadProjects, t, selectedProject, select],
  )

  /** 打开编辑对话框 */
  const handleEdit = useCallback((project: ScenarioProject, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingProject(project)
  }, [])

  /** 编辑保存成功后的处理 */
  const handleEditSaved = useCallback(
    (updated: ScenarioProject) => {
      setEditingProject(null)
      // 更新列表中对应项
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      // 若编辑的是当前选中项目，同步刷新 selectedProjectStore
      if (selectedProject?.id === updated.id) {
        void refreshSelected()
      }
    },
    [selectedProject, refreshSelected],
  )

  /**
   * AI 开发：打开工作区文件树 + 定位项目目录 + 显示聊天窗口。
   *
   * 与"可视化开发"（进入 ProjectWorkspacePanel 图形化 Tab 编辑器）互补，
   * 这是"文件树 + AI 对话"的协作开发模式：
   * - 切到 explorer 面板（聊天窗口在编辑器布局下显示）
   * - 显式 setChatVisible(true)，确保从 hideChat 面板切来时聊天可见
   * - 在文件树展开并定位到项目目录（优先 scenario.json）
   *
   * 不替换工作区根目录，保留 .aweeclaw 配置。
   */
  const handleOpenInWorkspace = useCallback(
    async (project: ScenarioProject, e: React.MouseEvent) => {
      e.stopPropagation()
      if (openingWorkspaceId) return // 防止重复点击
      setOpeningWorkspaceId(project.id)
      try {
        const exists = await api.file.exists(project.localPath)
        if (!exists) {
          toast.error(t('builder.project.dirNotFound'), project.localPath)
          setLocalError({
            operationLabel: t('builder.project.aiDevelop'),
            projectName: project.name,
            message: t('builder.project.dirNotFound'),
            detail: project.localPath,
            timestamp: Date.now(),
          })
          return
        }

        const currentWorkspacePath = useStore.getState().workspacePath
        if (!currentWorkspacePath) {
          toast.error(t('builder.project.noWorkspace'))
          setLocalError({
            operationLabel: t('builder.project.aiDevelop'),
            projectName: project.name,
            message: t('builder.project.noWorkspace'),
            timestamp: Date.now(),
          })
          return
        }

        // 规范化路径比较：判断项目目录是否在当前工作区内
        const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
        const workspaceNorm = norm(currentWorkspacePath)
        const projectNorm = norm(project.localPath)
        const inWorkspace =
          projectNorm === workspaceNorm || projectNorm.startsWith(workspaceNorm + '/')

        if (!inWorkspace) {
          toast.error(t('builder.project.notInWorkspace'), project.localPath)
          setLocalError({
            operationLabel: t('builder.project.aiDevelop'),
            projectName: project.name,
            message: t('builder.project.notInWorkspace'),
            detail: project.localPath,
            timestamp: Date.now(),
          })
          return
        }

        // 仅展开并定位到项目目录，不改变工作区根目录（保留 .aweeclaw 等工作区配置）
        setActiveSidePanel('explorer')
        setSelectedFolder(project.localPath)
        // 显式显示聊天窗口：AI 开发模式下需要 AI 辅助对话（从 hideChat 面板切来时 chatVisible 可能为 false）
        setChatVisible(true)

        // 定位策略：优先 reveal 到项目内的 scenario.json（场景配置文件），
        // 这样会自动展开项目目录并定位到配置文件，与编辑器 tab 右键"在侧边栏中定位"行为一致。
        // 若 scenario.json 不存在，则回退到 reveal 项目目录本身。
        const scenarioJsonPath = `${project.localPath}/scenario.json`
        const scenarioJsonExists = await api.file.exists(scenarioJsonPath)
        const revealTarget = scenarioJsonExists ? scenarioJsonPath : project.localPath
        window.dispatchEvent(
          new CustomEvent('explorer:reveal-file', { detail: { filePath: revealTarget } }),
        )
        toast.success(t('builder.project.aiDevelopDone'), project.name)
      } catch (err) {
        console.error('Failed to open project in workspace:', err)
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(msg || t('builder.project.dirNotFound'), project.localPath)
        setLocalError({
          operationLabel: t('builder.project.openInWorkspace'),
          projectName: project.name,
          message: msg || t('builder.project.dirNotFound'),
          detail: project.localPath,
          timestamp: Date.now(),
        })
      } finally {
        setOpeningWorkspaceId(null)
      }
    },
    [openingWorkspaceId, setActiveSidePanel, setSelectedFolder, setChatVisible, t],
  )

  const filteredProjects = searchQuery
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.scenarioId.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : projects

  const statusColors: Record<ProjectStatus, string> = {
    draft: 'bg-gray-500/10 text-gray-500',
    developing: 'bg-blue-500/10 text-blue-500',
    building: 'bg-yellow-500/10 text-yellow-500',
    ready: 'bg-emerald-500/10 text-emerald-500',
    published: 'bg-purple-500/10 text-purple-500',
    archived: 'bg-gray-500/10 text-gray-400',
  }

  /** 格式化相对时间，便于卡片展示 */
  const formatTime = (iso?: string): string => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const now = Date.now()
      const diff = now - d.getTime()
      const min = Math.floor(diff / 60000)
      const hour = Math.floor(min / 60)
      const day = Math.floor(hour / 24)
      if (min < 1) return '刚刚'
      if (min < 60) return `${min} 分钟前`
      if (hour < 24) return `${hour} 小时前`
      if (day < 30) return `${day} 天前`
      return d.toLocaleDateString()
    } catch {
      return '-'
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.project.title')}</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground hover:bg-accent/90"
        >
          + {t('builder.project.create')}
        </button>
      </div>

      {/* 搜索 */}
      <div className="p-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('builder.project.search')}
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
      </div>

      {/* 项目列表 - 大卡片自适应网格布局 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.common.loading')}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.project.empty')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
            {filteredProjects.map((project) => {
              const opStates = operations.getStates(project.id)
              const anyRunning =
                opStates.validate === 'running' ||
                opStates.build === 'running' ||
                opStates.pack === 'running' ||
                opStates.install === 'running' ||
                opStates.publish === 'running'
              return (
                <div
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className={`group cursor-pointer rounded-lg border p-3 transition-all hover:shadow-md ${
                    selectedId === project.id
                      ? 'border-accent bg-accent/5 ring-1 ring-accent/20'
                      : 'border-border hover:border-accent/40 hover:bg-muted/30'
                  }`}
                >
                  {/* 第一行：项目名 + 状态 + 编辑/删除 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{project.name}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusColors[project.status]}`}>
                          {t(`builder.status.${project.status}`)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{project.scenarioId}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => handleEdit(project, e)}
                        className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={t('builder.common.edit')}
                        aria-label={t('builder.common.edit')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDelete(project, e)}
                        className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title={t('builder.project.delete')}
                        aria-label={t('builder.project.delete')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 第二行：描述（若有） */}
                  {project.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {project.description}
                    </p>
                  )}

                  {/* 第三行：元信息 - 版本 / 类型 / 最后构建 / 最后发布 */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium">v{project.version}</span>
                    <span className="text-border">·</span>
                    <span>{t(`builder.type.${project.type}`)}</span>
                    <span className="text-border">·</span>
                    <span title={t('builder.project.lastBuiltAt')}>
                      {t('builder.buildOverview.lastBuild')}: {formatTime(project.lastBuiltAt)}
                    </span>
                    {project.lastPublishedAt && (
                      <>
                        <span className="text-border">·</span>
                        <span title={t('builder.project.lastPublishedAt')}>
                          {t('builder.project.lastPublishedAt')}: {formatTime(project.lastPublishedAt)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* 第四行：可视化开发 / AI 开发（两种开发模式横向平铺） */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/60 pt-2.5">
                    {/* 可视化开发：进入项目工作区 Tab 编辑器（配置/提示词/工具/脚本/校验/预览/安装/发布） */}
                    <button
                      onClick={(e) => handleOpenWorkspace(project, e)}
                      disabled={anyRunning}
                      className="flex items-center justify-center gap-1.5 rounded bg-accent/90 px-2 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('builder.project.visualDevelopDesc')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </svg>
                      <span>{t('builder.project.visualDevelop')}</span>
                    </button>
                    {/* AI 开发：打开工作区文件树 + 定位项目 + 显示聊天窗口（配合 AI 辅助开发） */}
                    <button
                      onClick={(e) => handleOpenInWorkspace(project, e)}
                      disabled={openingWorkspaceId === project.id || anyRunning}
                      className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('builder.project.aiDevelopDesc')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
                      </svg>
                      <span>{openingWorkspaceId === project.id ? t('builder.common.loading') : t('builder.project.aiDevelop')}</span>
                    </button>
                  </div>

                  {/* 第五行：快捷操作按钮 - 校验 / 构建 / 打包 / 安装 / 发布 */}
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <ProjectActionButtons
                      project={project}
                      operations={operations}
                      size="compact"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      {showCreate && (
        <ProjectCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            setShowCreate(false)
            loadProjects()
            // 通知文件资源管理器刷新：项目目录已在磁盘创建，但文件树缓存未感知。
            if (result.localPath) {
              const parentDir = result.localPath.substring(0, result.localPath.lastIndexOf('/'))
              // 1. 直接失效全局目录缓存（不依赖 FileExplorer 是否挂载）
              directoryCacheService.invalidate(parentDir)
              // 2. 派发事件触发已挂载的 FileExplorer 重新加载
              window.dispatchEvent(
                new CustomEvent('workspace:files-changed', {
                  detail: { affectedPaths: [parentDir] },
                }),
              )
            }
          }}
        />
      )}

      {/* 编辑对话框 */}
      {editingProject && (
        <ProjectEditDialog
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSaved={handleEditSaved}
        />
      )}

      {/* 操作失败弹窗：强制提醒用户并展示错误详情（优先展示五大操作的失败，其次为本地操作如"在工作区定位"） */}
      <OperationErrorDialog
        error={operations.lastError ?? localError}
        onClose={() => {
          if (operations.lastError) {
            operations.dismissError()
          } else if (localError) {
            setLocalError(null)
          }
        }}
      />
    </div>
  )
}

export default ProjectListPanel
