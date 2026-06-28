/**
 * 项目列表面板
 *
 * 显示所有场景项目，支持创建、打开、编辑、删除、在工作区打开目录。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { projectService } from '../../services'
import type { ScenarioProject, ProjectStatus } from '../../types'
import { useI18n } from '@renderer/i18n'
import { api } from '@services/electronBridge'
import { useStore } from '@store'
import { toast } from '@components/foundation/NotificationProvider'
import { directoryCacheService } from '@services/dirCacheAdapter'
import ProjectCreateDialog from './ProjectCreateDialog'
import ProjectEditDialog from './ProjectEditDialog'
import { useSelectedProject } from '../../hooks/useSelectedProject'

const ProjectListPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, select, refresh: refreshSelected } = useSelectedProject()
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const setSelectedFolder = useStore((s) => s.setSelectedFolder)
  const [projects, setProjects] = useState<ScenarioProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingProject, setEditingProject] = useState<ScenarioProject | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null)

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

  const handleSelectProject = useCallback(
    (project: ScenarioProject) => {
      select(project)
    },
    [select],
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
   * 在工作区定位项目目录：展开父级目录链并滚动定位到项目目录节点。
   *
   * 不再使用 setWorkspace 替换工作区根目录，原因：
   * - 替换工作区根会导致原工作区的 .aweeclaw 配置目录丢失（项目目录中不存在该配置）。
   * - 仅需"展开 + 定位"即可满足用户在文件树中查看项目的需求。
   *
   * 实现步骤：
   * 1. 校验项目目录存在且位于当前工作区内（文件树仅基于 workspacePath 渲染）。
   * 2. 切换到资源管理器面板。
   * 3. 触发 explorer:reveal-file 事件，由 VirtualTreeRenderer 逐级加载并展开父级链、滚动到目标节点。
   * 4. setSelectedFolder 高亮选中项目目录。
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
          return
        }

        const currentWorkspacePath = useStore.getState().workspacePath
        if (!currentWorkspacePath) {
          toast.error(t('builder.project.noWorkspace'))
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
          return
        }

        // 仅展开并定位到项目目录，不改变工作区根目录（保留 .aweeclaw 等工作区配置）
        setActiveSidePanel('explorer')
        setSelectedFolder(project.localPath)

        // 定位策略：优先 reveal 到项目内的 scenario.json（场景配置文件），
        // 这样会自动展开项目目录并定位到配置文件，与编辑器 tab 右键"在侧边栏中定位"行为一致。
        // 若 scenario.json 不存在，则回退到 reveal 项目目录本身。
        const scenarioJsonPath = `${project.localPath}/scenario.json`
        const scenarioJsonExists = await api.file.exists(scenarioJsonPath)
        const revealTarget = scenarioJsonExists ? scenarioJsonPath : project.localPath
        window.dispatchEvent(
          new CustomEvent('explorer:reveal-file', { detail: { filePath: revealTarget } }),
        )
        toast.success(t('builder.project.openInWorkspaceDone'), project.name)
      } catch (err) {
        console.error('Failed to open project in workspace:', err)
        toast.error((err as Error).message || t('builder.project.dirNotFound'), project.localPath)
      } finally {
        setOpeningWorkspaceId(null)
      }
    },
    [openingWorkspaceId, setActiveSidePanel, setSelectedFolder, t],
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

      {/* 项目列表 - 宽屏自适应网格布局 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.common.loading')}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.project.empty')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => handleSelectProject(project)}
                className={`cursor-pointer rounded-lg border p-3 transition-all hover:scale-[1.02] ${
                  selectedId === project.id
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/20'
                    : 'border-border hover:border-accent/40 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{project.name}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${statusColors[project.status]}`}>
                        {t(`builder.status.${project.status}`)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{project.scenarioId}</div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>v{project.version}</span>
                      <span>·</span>
                      <span>{t(`builder.type.${project.type}`)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
                {/* 在工作区打开项目目录 */}
                <button
                  onClick={(e) => handleOpenInWorkspace(project, e)}
                  disabled={openingWorkspaceId === project.id}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title={t('builder.project.openInWorkspaceDesc')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>{openingWorkspaceId === project.id ? t('builder.common.loading') : t('builder.project.openInWorkspace')}</span>
                </button>
              </div>
            ))}
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
    </div>
  )
}

export default ProjectListPanel
