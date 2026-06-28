/**
 * 构建状态栏
 *
 * 显示当前选中项目、状态、版本、最近构建时间等信息。
 * 通过 useSelectedProject 共享状态，自动联动。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import type { ProjectStatus } from '../../types'

const statusColors: Record<ProjectStatus, string> = {
  draft: 'text-gray-500',
  developing: 'text-blue-500',
  building: 'text-yellow-500',
  ready: 'text-emerald-500',
  published: 'text-purple-500',
  archived: 'text-gray-400',
}

const BuilderStatusBar: React.FC = () => {
  const { t } = useI18n()
  const { project, loading } = useSelectedProject()

  if (loading && !project) {
    return (
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span>{t('builder.common.loading')}</span>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span>{t('builder.statusBar.noProject')}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{project.name}</span>
      <span className={`font-medium ${statusColors[project.status]}`}>
        {t(`builder.status.${project.status}`)}
      </span>
      <span>v{project.version}</span>
      <span>·</span>
      <span>{t(`builder.type.${project.type}`)}</span>
      {project.lastBuiltAt && (
        <>
          <span>·</span>
          <span>{t('builder.statusBar.lastBuilt')}: {project.lastBuiltAt}</span>
        </>
      )}
    </div>
  )
}

export default BuilderStatusBar
