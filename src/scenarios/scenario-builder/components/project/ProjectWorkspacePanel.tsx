/**
 * 项目工作区面板（ProjectWorkspacePanel）
 *
 * 聚合所有"单项目操作"，以 Tab 形式承载：
 *   开发：配置 / 提示词 / 工具 / 脚本 / 数据库
 *   调试：校验 / 预览
 *   发布：安装 / 发布
 *
 * 设计动机：
 * - 场景开发助手支持多项目开发，这些操作只对"当前选中项目"生效，
 *   不应作为全局侧边栏入口（避免无项目时点击为空、多项目时语义割裂）。
 * - 由项目列表卡片的"打开工作区"按钮激活（setActiveSidePanel('project-workspace')）。
 *
 * 各子面板均通过 useSelectedProject 自取当前项目，无需本组件透传。
 */
import { useState, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useStore } from '@store'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import type { ProjectStatus } from '../../types'
import ScenarioConfigEditor from '../editor/ScenarioConfigEditor'
import PromptEditor from '../editor/PromptEditor'
import ToolDefinitionEditor from '../editor/ToolDefinitionEditor'
import ScriptEditor from '../editor/ScriptEditor'
import DbScriptEditor from '../editor/DbScriptEditor'
import ValidationResultPanel from '../editor/ValidationResultPanel'
import PreviewPanel from '../preview/PreviewPanel'
import InstallPanel from '../install/InstallPanel'
import PublishPanel from '../publish/PublishPanel'

/** 工作区 Tab 定义 */
interface WorkspaceTab {
  id: string
  labelKey: string
  group: 'develop' | 'debug' | 'publish'
  render: () => React.ReactNode
}

/** 项目状态徽章配色 */
const statusColors: Record<ProjectStatus, string> = {
  draft: 'bg-gray-500/10 text-gray-500',
  developing: 'bg-blue-500/10 text-blue-500',
  building: 'bg-yellow-500/10 text-yellow-500',
  ready: 'bg-emerald-500/10 text-emerald-500',
  published: 'bg-purple-500/10 text-purple-500',
  archived: 'bg-gray-500/10 text-gray-400',
}

const ProjectWorkspacePanel: React.FC = () => {
  const { t } = useI18n()
  const { project, loading } = useSelectedProject()
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const [activeTab, setActiveTab] = useState<string>('config')

  const tabs = useMemo<WorkspaceTab[]>(() => [
    { id: 'config', labelKey: 'builder.workspace.tab.config', group: 'develop', render: () => <ScenarioConfigEditor /> },
    { id: 'prompts', labelKey: 'builder.workspace.tab.prompts', group: 'develop', render: () => <PromptEditor /> },
    { id: 'tools', labelKey: 'builder.workspace.tab.tools', group: 'develop', render: () => <ToolDefinitionEditor /> },
    { id: 'scripts', labelKey: 'builder.workspace.tab.scripts', group: 'develop', render: () => <ScriptEditor /> },
    { id: 'database', labelKey: 'builder.workspace.tab.database', group: 'develop', render: () => <DbScriptEditor /> },
    { id: 'validation', labelKey: 'builder.workspace.tab.validation', group: 'debug', render: () => <ValidationResultPanel /> },
    { id: 'preview', labelKey: 'builder.workspace.tab.preview', group: 'debug', render: () => <PreviewPanel /> },
    { id: 'install', labelKey: 'builder.workspace.tab.install', group: 'publish', render: () => <InstallPanel /> },
    { id: 'publish', labelKey: 'builder.workspace.tab.publish', group: 'publish', render: () => <PublishPanel /> },
  ], [])

  // 空状态：未选中项目
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t('builder.common.loading')}
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="rounded-full bg-muted/40 p-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <p className="text-sm font-medium">{t('builder.workspace.empty')}</p>
        <p className="text-xs text-muted-foreground">{t('builder.workspace.emptyHint')}</p>
        <button
          onClick={() => setActiveSidePanel('projects')}
          className="mt-1 rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent/90"
        >
          {t('builder.workspace.gotoProjects')}
        </button>
      </div>
    )
  }

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const groupLabels: Record<WorkspaceTab['group'], string> = {
    develop: t('builder.workspace.group.develop'),
    debug: t('builder.workspace.group.debug'),
    publish: t('builder.workspace.group.publish'),
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部：当前项目信息 */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{project.name}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusColors[project.status]}`}>
              {t(`builder.status.${project.status}`)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.scenarioId} · v{project.version} · {t(`builder.type.${project.type}`)}
          </div>
        </div>
        <button
          onClick={() => setActiveSidePanel('projects')}
          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
          title={t('builder.workspace.backToList')}
        >
          {t('builder.workspace.backToList')}
        </button>
      </div>

      {/* Tab 栏：按分组排列，可横向滚动 */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/20 px-2 py-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === currentTab.id
          const showGroupSep =
            tab === tabs.find((tt) => tt.group === tab.group) && tab.group !== 'develop'
          return (
            <div key={tab.id} className="flex items-center">
              {showGroupSep && <div className="mx-1 h-4 w-px bg-border/60" />}
              <button
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
                title={groupLabels[tab.group]}
              >
                {t(tab.labelKey)}
              </button>
            </div>
          )
        })}
      </div>

      {/* Tab 内容 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {currentTab.render()}
      </div>
    </div>
  )
}

export default ProjectWorkspacePanel
