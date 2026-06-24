/**
 * 项目列表面板
 *
 * 显示所有场景项目，支持创建、打开、删除。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { projectService } from '../../services'
import type { ScenarioProject, ProjectStatus } from '../../types'
import { useI18n } from '@renderer/i18n'
import ProjectCreateDialog from './ProjectCreateDialog'

const ProjectListPanel: React.FC = () => {
  const { t } = useI18n()
  const [projects, setProjects] = useState<ScenarioProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const handleDelete = useCallback(
    async (projectId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm(t('builder.project.delete') + '?')) return
      try {
        await projectService.deleteProject(projectId)
        await loadProjects()
      } catch (err) {
        console.error('Failed to delete project:', err)
      }
    },
    [loadProjects, t],
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

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.common.loading')}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.project.empty')}</div>
        ) : (
          <ul className="space-y-1 p-2">
            {filteredProjects.map((project) => (
              <li
                key={project.id}
                onClick={() => setSelectedId(project.id)}
                className={`cursor-pointer rounded border p-2 transition-colors ${
                  selectedId === project.id
                    ? 'border-accent bg-accent/5'
                    : 'border-transparent hover:bg-muted'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{project.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusColors[project.status]}`}>
                        {t(`builder.status.${project.status}`)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{project.scenarioId}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>v{project.version}</span>
                      <span>·</span>
                      <span>{t(`builder.type.${project.type}`)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(project.id, e)}
                    className="text-muted-foreground hover:text-destructive"
                    title={t('builder.project.delete')}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
    </div>
  )
}

export default ProjectListPanel
