/**
 * 影响文件树组件
 *
 * 渲染每个变更文件及其受影响文件列表（含调用深度）。
 * 支持展开/收起单个变更文件的影响列表，也支持全部展开/收起。
 * 阶段9 s9-09：在变更文件项中额外展示 Git 伴随修改文件列表。
 */
import { memo, useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, FileCode, FileText, AlertTriangle, GitBranch } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

/** 单个受影响文件 */
interface ImpactedFileNode {
  filePath: string
  relativePath: string
  depth: number
  isTest: boolean
}

/** 伴随修改文件项（阶段9 s9-09） */
interface CoModifiedFileNode {
  relativePath: string
  coOccurrence: number
  frequency: number
}

/** 单个变更文件的结果 */
export interface ImpactResultItem {
  changedFile: string
  relativePath: string
  changeType: 'modified' | 'added' | 'deleted' | 'renamed'
  impactedFiles: ImpactedFileNode[]
  impactedCount: number
  nonTestCount: number
  testCount: number
  impactLevel: 'high' | 'medium' | 'low' | 'none'
  maxDepth: number
  /** Git 伴随修改文件列表（阶段9 s9-09，可选） */
  coModifiedFiles?: CoModifiedFileNode[]
  /** 该文件在 git 历史中出现的 commit 数（阶段9 s9-09，可选） */
  coModifiedTotalCommits?: number
}

interface ImpactFileTreeProps {
  /** 影响分析结果列表 */
  results: ImpactResultItem[]
  /** 语言 */
  language: Language
  /** 外部展开控制（可选）。如果未提供，则使用内部状态 */
  externalExpandAll?: boolean | null
}

/** 影响等级样式 */
const LEVEL_STYLES: Record<ImpactResultItem['impactLevel'], { cls: string; label: string }> = {
  high: { cls: 'bg-red-500/15 text-red-500 border-red-500/30', label: 'perception.impact.levelHigh' },
  medium: { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30', label: 'perception.impact.levelMedium' },
  low: { cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', label: 'perception.impact.levelLow' },
  none: { cls: 'bg-gray-500/15 text-text-muted border-border/40', label: 'perception.impact.levelNone' },
}

/** 变更类型样式 */
const CHANGE_TYPE_CLS: Record<ImpactResultItem['changeType'], string> = {
  modified: 'bg-amber-500/10 text-amber-500',
  added: 'bg-emerald-500/10 text-emerald-500',
  deleted: 'bg-red-500/10 text-red-500',
  renamed: 'bg-cyan-500/10 text-cyan-500',
}

export const ImpactFileTree = memo(function ImpactFileTree({
  results,
  language,
  externalExpandAll = null,
}: ImpactFileTreeProps) {
  // 内部维护每个变更文件的展开状态
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set())

  // 外部展开控制：当 externalExpandAll 变化时，全展开或全收起
  useEffect(() => {
    if (externalExpandAll === true) {
      setExpandedSet(new Set(results.map(r => r.changedFile)))
    } else if (externalExpandAll === false) {
      setExpandedSet(new Set())
    }
  }, [externalExpandAll, results])

  const toggleExpand = (file: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        {t('perception.impact.noResults', language)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {results.map(result => {
        const isExpanded = expandedSet.has(result.changedFile)
        const levelStyle = LEVEL_STYLES[result.impactLevel]
        return (
          <div
            key={result.changedFile}
            className="rounded-xl border border-border/40 bg-surface/30 overflow-hidden"
          >
            {/* 变更文件头 */}
            <button
              onClick={() => toggleExpand(result.changedFile)}
              className="w-full flex items-center gap-3 p-3 hover:bg-surface/50 transition-colors text-left"
            >
              <div className="shrink-0">
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-text-muted" />
                  : <ChevronRight className="w-4 h-4 text-text-muted" />
                }
              </div>
              <FileCode className="w-4 h-4 text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">
                  {result.relativePath || result.changedFile}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${CHANGE_TYPE_CLS[result.changeType]}`}>
                    {t(`perception.impact.changeType.${result.changeType}`, language)}
                  </span>
                  <span>{t('perception.impact.impactedFiles', language)}: {result.impactedCount}</span>
                  <span>·</span>
                  <span>{t('perception.impact.maxDepth', language)}: {result.maxDepth}</span>
                </div>
              </div>
              <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${levelStyle.cls}`}>
                {t(levelStyle.label, language)}
              </span>
            </button>

            {/* 受影响文件列表 */}
            {isExpanded && result.impactedFiles.length > 0 && (
              <div className="border-t border-border/30 bg-surface/20">
                <div className="py-2 px-3 space-y-1">
                  {result.impactedFiles.map((file, idx) => (
                    <div
                      key={`${file.filePath}-${idx}`}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface/40"
                      style={{ paddingLeft: `${8 + file.depth * 16}px` }}
                    >
                      {/* 深度指示线 */}
                      {file.depth > 0 && (
                        <div className="flex items-center gap-1 text-text-muted/40">
                          {Array.from({ length: file.depth }, (_, i) => (
                            <span key={i} className="text-[10px]">↳</span>
                          ))}
                        </div>
                      )}
                      {file.isTest ? (
                        <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <FileCode className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      )}
                      <span className="text-[12px] text-text-primary truncate flex-1">
                        {file.relativePath || file.filePath}
                      </span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {t('perception.impact.depth', language)}: {file.depth}
                      </span>
                      {file.isTest && (
                        <span className="text-[10px] text-amber-500 shrink-0">
                          {t('perception.impact.testFile', language)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 展开后无受影响文件 */}
            {isExpanded && result.impactedFiles.length === 0 && (
              <div className="border-t border-border/30 bg-surface/20 py-3 px-6 text-[12px] text-text-muted flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('perception.impact.noResults', language)}
              </div>
            )}

            {/* 伴随修改文件列表（阶段9 s9-09） */}
            {isExpanded && result.coModifiedFiles && result.coModifiedFiles.length > 0 && (
              <div className="border-t border-border/30 bg-cyan-500/5">
                <div className="py-2 px-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-500 uppercase tracking-wider mb-1.5 px-2">
                    <GitBranch className="w-3 h-3" />
                    {t('perception.impact.coModification.coModifiedFiles', language)}
                    {typeof result.coModifiedTotalCommits === 'number' && result.coModifiedTotalCommits > 0 && (
                      <span className="text-text-muted font-normal normal-case tracking-normal">
                        · {t('perception.impact.coModification.totalCommitsOfFile', language)}: {result.coModifiedTotalCommits}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {result.coModifiedFiles.map((file, idx) => (
                      <div
                        key={`${file.relativePath}-${idx}`}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-cyan-500/10"
                      >
                        <FileCode className="w-3.5 h-3.5 text-cyan-500/70 shrink-0" />
                        <span className="text-[12px] text-text-primary truncate flex-1">
                          {file.relativePath}
                        </span>
                        <span className="text-[10px] text-text-muted shrink-0">
                          {t('perception.impact.coModification.coOccurrence', language)}: {file.coOccurrence}
                        </span>
                        <span className="text-[10px] text-cyan-500 shrink-0 font-medium">
                          {(file.frequency * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})
