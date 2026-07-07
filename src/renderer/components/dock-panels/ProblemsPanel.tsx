/**
 * 问题（Problems）面板
 *
 * 展示 LSP 诊断信息，支持：
 * - 按严重级别过滤（错误 / 警告 / 信息 / 提示）
 * - 按文件分组折叠展示
 * - 点击诊断项跳转到对应文件位置
 * - 一键清空
 */
import { useState, useMemo, useCallback } from 'react'
import type React from 'react'
import {
  XCircle, AlertCircle, Info, Lightbulb,
  ChevronRight, Trash2, FileCode, RefreshCw,
} from 'lucide-react'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { useStore } from '@store'
import { safeOpenFile } from '@renderer/toolkit/fileUtils'
import { getFileName, getDirname } from '@shared/toolkit/pathHelper'
import type { LspDiagnostic } from '@protocols'
import { t } from '@renderer/i18n'

const SEVERITY = {
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
  HINT: 4,
} as const

type SeverityValue = (typeof SEVERITY)[keyof typeof SEVERITY]

const SEVERITY_VISUAL: Record<number, {
  Icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
}> = {
  [SEVERITY.ERROR]: { Icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  [SEVERITY.WARNING]: { Icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  [SEVERITY.INFO]: { Icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  [SEVERITY.HINT]: { Icon: Lightbulb, color: 'text-text-muted', bg: 'bg-surface/40' },
}

interface FileGroup {
  filePath: string
  items: LspDiagnostic[]
  errorCount: number
  warningCount: number
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file:///')) return decodeURIComponent(uri.slice(8))
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice(7))
  return uri
}

const ProblemsPanel: React.FC = () => {
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics)
  const version = useDiagnosticsStore((s) => s.version)
  const clearAll = useDiagnosticsStore((s) => s.clearAll)
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const language = useStore((s) => s.language)

  const [activeFilter, setActiveFilter] = useState<SeverityValue | null>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

  const stats = useMemo(() => {
    let errors = 0, warnings = 0, infos = 0, hints = 0
    diagnostics.forEach((items) => {
      items.forEach((d) => {
        switch (d.severity) {
          case SEVERITY.ERROR: errors++; break
          case SEVERITY.WARNING: warnings++; break
          case SEVERITY.INFO: infos++; break
          case SEVERITY.HINT: hints++; break
        }
      })
    })
    return { errors, warnings, infos, hints, total: errors + warnings + infos + hints }
  }, [diagnostics, version])

  const fileGroups = useMemo<FileGroup[]>(() => {
    const groups: FileGroup[] = []
    diagnostics.forEach((items, uri) => {
      const filePath = uriToPath(uri)
      const filtered = activeFilter
        ? items.filter((d) => d.severity === activeFilter)
        : items
      if (filtered.length === 0) return

      groups.push({
        filePath,
        items: filtered,
        errorCount: items.filter((d) => d.severity === SEVERITY.ERROR).length,
        warningCount: items.filter((d) => d.severity === SEVERITY.WARNING).length,
      })
    })
    return groups.sort((a, b) => b.errorCount - a.errorCount || b.warningCount - a.warningCount)
  }, [diagnostics, version, activeFilter])

  const toggleFile = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }, [])

  const handleDiagnosticClick = useCallback(async (filePath: string, diag: LspDiagnostic) => {
    setActiveSidePanel('explorer')
    await safeOpenFile(filePath, { showWarning: false, confirmLargeFile: false })
    useStore.getState().setCursorPosition({
      line: diag.range.start.line + 1,
      column: diag.range.start.character + 1,
    })
  }, [setActiveSidePanel])

  const toggleFilter = useCallback((severity: SeverityValue) => {
    setActiveFilter((prev) => (prev === severity ? null : severity))
  }, [])

  const filterConfig = [
    { severity: SEVERITY.ERROR, label: t('problems.errors', language), Icon: XCircle, color: 'text-red-400', count: stats.errors },
    { severity: SEVERITY.WARNING, label: t('problems.warnings', language), Icon: AlertCircle, color: 'text-amber-400', count: stats.warnings },
    { severity: SEVERITY.INFO, label: t('problems.info', language), Icon: Info, color: 'text-blue-400', count: stats.infos },
    { severity: SEVERITY.HINT, label: t('problems.hints', language), Icon: Lightbulb, color: 'text-text-muted', count: stats.hints },
  ]

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6 py-8">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
          <Lightbulb className="w-6 h-6 text-emerald-400" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-text-primary">{t('problems.noProblems', language)}</p>
        <p className="text-xs text-text-muted mt-1 text-center leading-relaxed">
          {t('problems.noProblemsDescription', language)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background-editor">
      {/* 过滤器 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/40">
        {filterConfig.map((filter) => {
          const Icon = filter.Icon
          const isActive = activeFilter === filter.severity
          return (
            <button
              key={filter.severity}
              onClick={() => toggleFilter(filter.severity)}
              disabled={filter.count === 0}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors disabled:opacity-40 ${
                isActive ? 'bg-surface-hover text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-surface/60'
              }`}
            >
              <Icon className={`w-3 h-3 ${filter.color}`} />
              <span className="font-mono">{filter.count}</span>
            </button>
          )
        })}
        <div className="flex-1" />
        <button onClick={() => clearAll()} className="flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* 诊断列表 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {fileGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted px-6 py-8">
            <RefreshCw className="w-5 h-5 mb-2 opacity-50" />
            <p className="text-xs">No items match the current filter</p>
          </div>
        ) : (
          <div className="py-1">
            {fileGroups.map((group) => {
              const fileName = getFileName(group.filePath)
              const dirName = getDirname(group.filePath) || '.'
              const isCollapsed = collapsedFiles.has(group.filePath)
              return (
                <div key={group.filePath} className="mb-0.5">
                  <button onClick={() => toggleFile(group.filePath)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-surface-hover transition-colors">
                    <ChevronRight className={`w-3 h-3 text-text-muted flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                    <FileCode className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <span className="font-medium text-text-primary truncate flex-1">{fileName}</span>
                    <span className="text-[10px] text-text-muted/70 truncate max-w-[120px]">{dirName}</span>
                    {group.errorCount > 0 && <span className="flex items-center gap-0.5 text-[10px] font-mono text-red-400"><XCircle className="w-2.5 h-2.5" />{group.errorCount}</span>}
                    {group.warningCount > 0 && <span className="flex items-center gap-0.5 text-[10px] font-mono text-amber-400"><AlertCircle className="w-2.5 h-2.5" />{group.warningCount}</span>}
                  </button>
                  {!isCollapsed && (
                    <div className="mb-0.5">
                      {group.items.map((diag, idx) => {
                        const visual = SEVERITY_VISUAL[diag.severity ?? SEVERITY.ERROR]
                        const Icon = visual.Icon
                        const line = diag.range.start.line + 1
                        const col = diag.range.start.character + 1
                        return (
                          <button key={`${idx}-${line}-${col}`} onClick={() => handleDiagnosticClick(group.filePath, diag)} className="w-full flex items-start gap-2 pl-7 pr-2 py-1.5 text-left text-xs hover:bg-surface-hover transition-colors">
                            <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${visual.color}`} />
                            <div className="flex-1 min-w-0">
                              <span className="text-text-secondary break-words leading-relaxed block">{diag.message}</span>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted/70">
                                <span className="font-mono">Ln {line}, Col {col}</span>
                                {diag.source && <span className="px-1 py-0 rounded bg-surface/60 font-mono">{diag.source}</span>}
                                {diag.code !== undefined && <span className="font-mono opacity-60">{String(diag.code)}</span>}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 text-[10px] text-text-muted/70 font-mono">
        <span>{fileGroups.length} file(s)</span>
        <span>{activeFilter ? (activeFilter === SEVERITY.ERROR ? stats.errors : activeFilter === SEVERITY.WARNING ? stats.warnings : activeFilter === SEVERITY.INFO ? stats.infos : stats.hints) : stats.total} item(s)</span>
      </div>
    </div>
  )
}

export default ProblemsPanel
