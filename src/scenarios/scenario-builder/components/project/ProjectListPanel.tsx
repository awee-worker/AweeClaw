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
import ProjectCreateDialog from './ProjectCreateDialog'
import ProjectEditDialog from './ProjectEditDialog'
import { useSelectedProject } from '../../hooks/useSelectedProject'

const ProjectListPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, select, refresh: refreshSelected } = useSelectedProject()
  const setWorkspace = useStore((s) => s.setWorkspace)
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
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
    async (projectId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm(t('builder.project.delete') + '?')) return
      try {
        await projectService.deleteProject(projectId)
        // 如果删除的是当前选中项目，清空选中
        if (selectedProject?.id === projectId) {
          select(null)
        }
        await loadProjects()
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
   * 在工作区打开项目目录：将 localPath 设为工作区根并切换到资源管理器面板。
   *
   * 使用 setWorkspace 而非 addRoot 的原因：
   * - FileExplorer 的文件树仅基于 workspacePath（= roots[0]）加载，addRoot 不会更新 workspacePath，
   *   导致新加的根不会显示在文件树中。
   * - setWorkspace 会更新 workspacePath、自动将根加入 expandedFolders（展开根节点）、
   *   并触发 FileExplorer 的 useEffect([workspacePath]) 重新加载目录子项。
   *
   * 若目录不存在则提示用户先构建项目。
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
        // 将项目目录设为工作区根：更新 workspacePath、展开根节点、触发文件树刷新
        setWorkspace({ configPath: null, roots: [project.localPath] })
        setActiveSidePanel('explorer')
        toast.success(t('builder.project.openInWorkspaceDone'), project.name)
      } catch (err) {
        console.error('Failed to open project in workspace:', err)
        toast.error((err as Error).message || t('builder.project.dirNotFound'), project.localPath)
      } finally {
        setOpeningWorkspaceId(null)
      }
    },
    [openingWorkspaceId, setWorkspace, setActiveSidePanel, t],
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
                      onClick={(e) => handleDelete(project.id, e)}
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
          onCreated={() => {
            setShowCreate(false)
            loadProjects()
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
