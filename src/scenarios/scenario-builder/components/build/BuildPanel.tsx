/**
 * 构建总览面板（重构版）
 *
 * 从「单项目操作」重构为「多项目构建管理总览」，解决多项目场景下：
 * - 需先在项目列表选中项目才能操作的割裂体验
 * - 无法横向对比所有项目构建状态的问题
 * - 频繁切换面板的低效操作
 *
 * 布局：
 * 1. 顶部工具栏：刷新全部 / 全部校验 / 全部构建
 * 2. 主体：所有项目构建状态卡片，每行一个项目
 *    - 项目名 + 状态 + 最近构建/打包结果徽章
 *    - 内联操作：校验 / 构建 / 打包
 *    - 可展开查看该项目构建历史
 * 3. 底部：选中构建记录的日志输出
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type React from 'react'
import { buildService, projectService } from '../../services'
import type { ScenarioProject, BuildRecord, ProjectStatus, BuildStatus } from '../../types'
import { useI18n } from '@renderer/i18n'
import { useProjectOperations } from '../../hooks/useProjectOperations'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import ProjectActionButtons from '../project/ProjectActionButtons'
import OperationErrorDialog from '../project/OperationErrorDialog'

/** 项目状态徽章配色 */
const statusColors: Record<ProjectStatus, string> = {
  draft: 'bg-gray-500/10 text-gray-500',
  developing: 'bg-blue-500/10 text-blue-500',
  building: 'bg-yellow-500/10 text-yellow-500',
  ready: 'bg-emerald-500/10 text-emerald-500',
  published: 'bg-purple-500/10 text-purple-500',
  archived: 'bg-gray-500/10 text-gray-400',
}

/** 构建记录状态徽章配色 */
const buildStatusColors: Record<BuildStatus, string> = {
  success: 'bg-emerald-500/10 text-emerald-600',
  failed: 'bg-destructive/10 text-destructive',
  running: 'bg-yellow-500/10 text-yellow-600',
  pending: 'bg-gray-500/10 text-muted-foreground',
  cancelled: 'bg-gray-500/10 text-muted-foreground',
}

const BuildPanel: React.FC = () => {
  const { t } = useI18n()
  const { select } = useSelectedProject()
  const [projects, setProjects] = useState<ScenarioProject[]>([])
  const [loading, setLoading] = useState(true)
  /** 每个项目的构建历史（按需懒加载） */
  const [historyMap, setHistoryMap] = useState<Record<string, BuildRecord[]>>({})
  /** 展开历史的项目 ID 集合 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  /** 选中的构建记录（用于底部日志展示） */
  const [selectedRecord, setSelectedRecord] = useState<BuildRecord | null>(null)
  /** 批量操作进行中 */
  const [batchRunning, setBatchRunning] = useState(false)

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

  /** 加载某项目的构建历史 */
  const loadHistory = useCallback(async (projectId: string) => {
    try {
      const history = await buildService.getBuildHistory(projectId, 10)
      setHistoryMap((prev) => ({ ...prev, [projectId]: history }))
      return history
    } catch (err) {
      console.error('Failed to load build history:', err)
      return []
    }
  }, [])

  /** 快捷操作：完成后刷新项目列表 + 刷新对应项目历史（若已展开） */
  const operations = useProjectOperations(loadProjects, (payload) => {
    // 操作完成后，若该项目历史已展开，则刷新历史以显示最新记录
    if (expandedIds.has(payload.projectId)) {
      void loadHistory(payload.projectId)
    }
  })

  /** 切换展开/收起某项目的历史 */
  const toggleExpand = useCallback(
    async (project: ScenarioProject) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(project.id)) {
          next.delete(project.id)
        } else {
          next.add(project.id)
          // 懒加载历史
          if (!historyMap[project.id]) {
            void loadHistory(project.id)
          }
        }
        return next
      })
    },
    [historyMap, loadHistory],
  )

  /** 选中某条构建记录，展示日志 */
  const handleSelectRecord = useCallback((record: BuildRecord) => {
    setSelectedRecord(record)
  }, [])

  /** 刷新全部：重新加载项目列表与已展开项目的历史 */
  const handleRefreshAll = useCallback(async () => {
    await loadProjects()
    // 并发刷新已展开项目的历史
    const expandedArr = Array.from(expandedIds)
    if (expandedArr.length > 0) {
      await Promise.all(expandedArr.map((id) => loadHistory(id)))
    }
  }, [loadProjects, expandedIds, loadHistory])

  /** 批量校验：对所有项目依次执行校验 */
  const handleValidateAll = useCallback(async () => {
    if (batchRunning || projects.length === 0) return
    setBatchRunning(true)
    try {
      // 串行执行避免主进程 IPC 过载与 DB 写冲突
      for (const project of projects) {
        await operations.validate(project)
      }
      await handleRefreshAll()
    } finally {
      setBatchRunning(false)
    }
  }, [batchRunning, projects, operations, handleRefreshAll])

  /** 批量构建：对所有项目依次执行构建 */
  const handleBuildAll = useCallback(async () => {
    if (batchRunning || projects.length === 0) return
    setBatchRunning(true)
    try {
      for (const project of projects) {
        await operations.build(project)
      }
      await handleRefreshAll()
    } finally {
      setBatchRunning(false)
    }
  }, [batchRunning, projects, operations, handleRefreshAll])

  /** 获取某项目最近一次成功/失败的构建记录摘要 */
  const getLatestBuild = useCallback(
    (projectId: string): BuildRecord | null => {
      const history = historyMap[projectId]
      if (!history || history.length === 0) return null
      return history[0]
    },
    [historyMap],
  )

  /** 格式化构建类型显示 */
  const formatBuildType = useCallback((type: string): string => {
    const map: Record<string, string> = {
      validate: t('builder.action.validate'),
      build: t('builder.action.build'),
      pack: t('builder.action.pack'),
      dev: t('builder.toolbar.dev'),
    }
    return map[type] || type
  }, [t])

  /** 统计概览 */
  const stats = useMemo(() => {
    let ready = 0
    let building = 0
    let failed = 0
    for (const p of projects) {
      if (p.status === 'ready' || p.status === 'published') ready++
      else if (p.status === 'building') building++
      const latest = getLatestBuild(p.id)
      if (latest?.status === 'failed') failed++
    }
    return { total: projects.length, ready, building, failed }
  }, [projects, getLatestBuild])

  return (
    <div className="flex h-full flex-col">
      {/* 头部标题 + 副标题 */}
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-medium">{t('builder.buildOverview.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('builder.buildOverview.subtitle')}</p>
      </div>

      {/* 工具栏：刷新 / 全部校验 / 全部构建 + 统计 */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <button
          onClick={handleRefreshAll}
          disabled={batchRunning}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent disabled:opacity-50"
          title={t('builder.buildOverview.refreshAll')}
        >
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t('builder.buildOverview.refreshAll')}
          </span>
        </button>
        <button
          onClick={handleValidateAll}
          disabled={batchRunning || projects.length === 0}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent disabled:opacity-50"
          title={t('builder.buildOverview.validateAll')}
        >
          {t('builder.buildOverview.validateAll')}
        </button>
        <button
          onClick={handleBuildAll}
          disabled={batchRunning || projects.length === 0}
          className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
          title={t('builder.buildOverview.buildAll')}
        >
          {t('builder.buildOverview.buildAll')}
        </button>
        {/* 右侧统计 */}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {batchRunning && (
            <span className="flex items-center gap-1 text-yellow-500">
              <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {t('builder.buildOverview.batchRunning')}
            </span>
          )}
          <span>{t('builder.buildOverview.status')}: {stats.total}</span>
          <span className="text-emerald-500">✓ {stats.ready}</span>
          {stats.building > 0 && <span className="text-yellow-500">⏳ {stats.building}</span>}
          {stats.failed > 0 && <span className="text-destructive">✗ {stats.failed}</span>}
        </div>
      </div>

      {/* 主体：项目构建状态列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.common.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.buildOverview.noProjects')}</div>
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((project) => {
              const isExpanded = expandedIds.has(project.id)
              const history = historyMap[project.id] ?? []
              const latest = history[0] ?? null
              return (
                <li key={project.id} className="px-3 py-2.5">
                  {/* 项目行 */}
                  <div
                    onClick={() => select(project)}
                    className="cursor-pointer rounded p-1 transition-colors hover:bg-muted/40"
                  >
                    {/* 第一行：项目名 + 状态徽章 + 最近构建结果 */}
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{project.name}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusColors[project.status]}`}>
                        {t(`builder.status.${project.status}`)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">v{project.version}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">·</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t(`builder.type.${project.type}`)}</span>

                      {/* 最近构建结果徽章 */}
                      {latest && (
                        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${buildStatusColors[latest.status]}`}>
                          {formatBuildType(latest.buildType)} · {t(`builder.build.${latest.status === 'success' ? 'success' : latest.status === 'failed' ? 'failed' : 'running'}`)}
                        </span>
                      )}
                      {!latest && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {t('builder.buildOverview.noRecord')}
                        </span>
                      )}
                    </div>

                    {/* 第二行：内联操作按钮（校验/构建/打包/安装/发布） */}
                    <div className="mt-2">
                      <ProjectActionButtons
                        project={project}
                        operations={operations}
                        size="normal"
                      />
                    </div>

                    {/* 第三行：展开/收起历史按钮 */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleExpand(project)
                        }}
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        {isExpanded ? t('builder.buildOverview.hideHistory') : t('builder.buildOverview.showHistory')}
                      </button>
                    </div>
                  </div>

                  {/* 展开区：构建历史列表 */}
                  {isExpanded && (
                    <div className="ml-1 mt-2 rounded border border-border/60 bg-muted/20">
                      {history.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">{t('builder.build.empty')}</div>
                      ) : (
                        <ul className="divide-y divide-border/40">
                          {history.map((record) => (
                            <li
                              key={record.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSelectRecord(record)
                              }}
                              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/5 ${
                                selectedRecord?.id === record.id ? 'bg-accent/10' : ''
                              }`}
                            >
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${buildStatusColors[record.status]}`}>
                                {formatBuildType(record.buildType)}
                              </span>
                              <span className={`shrink-0 text-xs ${buildStatusColors[record.status].split(' ')[1]}`}>
                                {t(`builder.build.${record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'running'}`)}
                              </span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                {record.durationMs}ms
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {record.startedAt.replace('T', ' ').substring(0, 19)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 底部：构建日志输出 */}
      {selectedRecord && (
        <div className="h-44 shrink-0 border-t border-border">
          <div className="flex items-center justify-between border-b border-border px-2 py-1">
            <span className="text-xs font-medium">
              {t('builder.build.title')} · {formatBuildType(selectedRecord.buildType)}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(selectedRecord.output)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('builder.build.copy')}
            </button>
          </div>
          <pre className="h-32 overflow-auto bg-muted/30 p-2 text-xs font-mono whitespace-pre-wrap break-all">
            {selectedRecord.output || t('builder.build.empty')}
          </pre>
        </div>
      )}

      {/* 操作失败弹窗：强制提醒用户并展示错误详情 */}
      <OperationErrorDialog error={operations.lastError} onClose={operations.dismissError} />
    </div>
  )
}

export default BuildPanel
