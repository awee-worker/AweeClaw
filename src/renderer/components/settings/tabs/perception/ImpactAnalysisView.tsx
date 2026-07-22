/**
 * 代码影响分析主视图
 *
 * 全屏弹窗，提供：
 * - 输入变更文件（自动从 Git 状态获取 / 手动输入）
 * - 调用 perception.analyzeImpact 进行分析
 * - 可视化展示：总体影响等级、依赖图统计、变更文件影响树、高风险文件列表
 * - 支持重建依赖图（forceRebuild）
 *
 * 数据来源：
 * - useStore().workspacePath - 当前工作区路径
 * - useStore().gitStatus - 当前 Git 变更状态（自动模式使用）
 * - window.electronAPI.perception.analyzeImpact - 影响分析 IPC
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  AlertCircle, RefreshCw, Play, GitBranch, FileInput, Activity,
  Network, AlertTriangle,
} from 'lucide-react'
import { OverlayDialog } from '@components/ui'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { ImpactFileTree, type ImpactResultItem } from './ImpactFileTree'
import { CoModificationStatsCard } from './CoModificationStatsCard'

interface ImpactAnalysisViewProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
}

/** 影响分析响应（与 preload API 类型一致） */
interface ImpactAnalysisResponse {
  success: boolean
  projectPath: string
  overallImpact: 'high' | 'medium' | 'low' | 'none'
  totalImpactedFiles: number
  results: ImpactResultItem[]
  graphStats: {
    fileCount: number
    edgeCount: number
    builtAt: number
  }
  highRiskFiles: Array<{
    filePath: string
    relativePath: string
    impactedByCount: number
  }>
  /** Git 伴随修改分析统计（阶段9 s9-09，未启用时为 null） */
  coModificationStats?: {
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analyzedAt: number
    fromCache: boolean
  } | null
  error?: string
}

/** 输入模式 */
type InputMode = 'git' | 'manual'

/** 影响等级样式 */
const LEVEL_STYLES: Record<NonNullable<ImpactAnalysisResponse['overallImpact']>, { cls: string; label: string }> = {
  high: { cls: 'bg-red-500/15 text-red-500 border-red-500/30', label: 'perception.impact.levelHigh' },
  medium: { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30', label: 'perception.impact.levelMedium' },
  low: { cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', label: 'perception.impact.levelLow' },
  none: { cls: 'bg-gray-500/15 text-text-muted border-border/40', label: 'perception.impact.levelNone' },
}

/** 格式化时间戳 */
function formatTime(ts: number, language: Language): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const dateStr = t('perception.timeline.dateFormat', language, {
    month: String(d.getMonth() + 1),
    day: String(d.getDate()),
  })
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dateStr} ${hh}:${mm}`
}

export function ImpactAnalysisView({
  isOpen,
  onClose,
  language,
}: ImpactAnalysisViewProps) {
  const workspacePath = useStore(s => s.workspacePath)
  const gitStatus = useStore(s => s.gitStatus)

  const [inputMode, setInputMode] = useState<InputMode>('git')
  const [manualInput, setManualInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [result, setResult] = useState<ImpactAnalysisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandAllSignal, setExpandAllSignal] = useState<boolean | null>(null)

  /** 从 Git 状态提取变更文件列表 */
  const gitChangedFiles = useMemo(() => {
    if (!gitStatus) return []
    /** 将 Git 状态映射为 impact 支持的 4 种类型 */
    const mapStatus = (s: string): 'modified' | 'added' | 'deleted' | 'renamed' => {
      if (s === 'added' || s === 'modified' || s === 'deleted' || s === 'renamed') return s
      // copied / unmerged 等归一化为 modified
      return 'modified'
    }
    const files: Array<{
      filePath: string
      relativePath: string
      changeType: 'modified' | 'added' | 'deleted' | 'renamed'
    }> = []
    const normalize = (p: string) => {
      const fullPath = workspacePath ? `${workspacePath}/${p}` : p
      return { filePath: fullPath, relativePath: p }
    }
    for (const f of gitStatus.staged ?? []) {
      const { filePath, relativePath } = normalize(f.path)
      files.push({ filePath, relativePath, changeType: mapStatus(f.status) })
    }
    for (const f of gitStatus.unstaged ?? []) {
      const { filePath, relativePath } = normalize(f.path)
      // 去重（同一文件可能既在 staged 也在 unstaged）
      if (!files.some(x => x.relativePath === relativePath)) {
        files.push({ filePath, relativePath, changeType: mapStatus(f.status) })
      }
    }
    return files
  }, [gitStatus, workspacePath])

  /** 手动输入解析为文件列表 */
  const manualChangedFiles = useMemo(() => {
    if (!manualInput.trim()) return []
    const lines = manualInput.split('\n').map(l => l.trim()).filter(Boolean)
    return lines.map(line => {
      const fullPath = workspacePath && !line.startsWith('/')
        ? `${workspacePath}/${line}`
        : line
      const relativePath = workspacePath && fullPath.startsWith(workspacePath + '/')
        ? fullPath.slice(workspacePath.length + 1)
        : line
      return {
        filePath: fullPath,
        relativePath,
        changeType: 'modified' as const,
      }
    })
  }, [manualInput, workspacePath])

  /** 当前生效的变更文件列表 */
  const currentChangedFiles = inputMode === 'git' ? gitChangedFiles : manualChangedFiles

  /** 执行影响分析 */
  const runAnalysis = useCallback(async (forceRebuild = false) => {
    if (!workspacePath) {
      setError(t('perception.impact.noWorkspace', language))
      return
    }
    if (currentChangedFiles.length === 0) {
      setError(t('perception.impact.noChangedFiles', language))
      return
    }

    setAnalyzing(true)
    if (forceRebuild) setRebuilding(true)
    setError(null)

    try {
      const res = await window.electronAPI.perception.analyzeImpact({
        projectPath: workspacePath,
        changedFiles: currentChangedFiles,
        forceRebuild,
      })
      if (!res.success) {
        throw new Error(res.error || 'Analysis failed')
      }
      setResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.settings?.error('[ImpactAnalysisView] 分析失败:', e)
      setError(msg)
    } finally {
      setAnalyzing(false)
      setRebuilding(false)
    }
  }, [workspacePath, currentChangedFiles, language])

  // 打开时自动触发分析（仅 git 模式且有变更文件时）
  useEffect(() => {
    if (isOpen && inputMode === 'git' && gitChangedFiles.length > 0 && !result && !analyzing) {
      void runAnalysis(false)
    }
    // 切换为关闭状态时重置
    if (!isOpen) {
      setResult(null)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const levelStyle = result ? LEVEL_STYLES[result.overallImpact] : null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('perception.impact.title', language)}
      size="full"
      noPadding
    >
      <div className="p-6 space-y-5">
        {/* 顶部说明 + 操作按钮 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-text-primary">
              {t('perception.impact.title', language)}
            </h3>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('perception.impact.subtitle', language)}
            </p>
          </div>

          {result && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpandAllSignal(true)}
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-surface/40 border border-border/40 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all"
              >
                {t('perception.impact.expandAll', language)}
              </button>
              <button
                onClick={() => setExpandAllSignal(false)}
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-surface/40 border border-border/40 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all"
              >
                {t('perception.impact.collapseAll', language)}
              </button>
              <button
                onClick={() => void runAnalysis(true)}
                disabled={analyzing || rebuilding}
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
                {rebuilding ? t('perception.impact.rebuilding', language) : t('perception.impact.rebuild', language)}
              </button>
            </div>
          )}
        </div>

        {/* 输入区：模式切换 + 变更文件预览 */}
        <section className="p-4 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40 space-y-3">
          {/* 模式切换 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInputMode('git')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                inputMode === 'git'
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-surface/40 text-text-secondary hover:text-text-primary border border-border/40'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              {t('perception.impact.useGitFiles', language)}
            </button>
            <button
              onClick={() => setInputMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                inputMode === 'manual'
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-surface/40 text-text-secondary hover:text-text-primary border border-border/40'
              }`}
            >
              <FileInput className="w-3.5 h-3.5" />
              {t('perception.impact.manualInput', language)}
            </button>
            <span className="text-[11px] text-text-muted">
              {inputMode === 'git' ? t('perception.impact.useGitFilesDesc', language) : t('perception.impact.manualInputDesc', language)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-text-muted">
                {t('perception.impact.changedFiles', language)}: <strong className="text-text-primary">{currentChangedFiles.length}</strong>
              </span>
              <button
                onClick={() => void runAnalysis(false)}
                disabled={analyzing || rebuilding || currentChangedFiles.length === 0}
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-violet-500/15 text-violet-500 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                {analyzing ? t('perception.impact.analyzing', language) : t('perception.impact.analyze', language)}
              </button>
            </div>
          </div>

          {/* 模式内容 */}
          {inputMode === 'git' ? (
            <div className="text-[12px] text-text-muted">
              {workspacePath ? (
                <span>
                  {gitChangedFiles.length > 0
                    ? `${t('perception.impact.changedFiles', language)}: ${gitChangedFiles.map(f => f.relativePath).join(', ')}`
                    : t('perception.impact.noChangedFiles', language)}
                </span>
              ) : (
                <span className="text-amber-500">{t('perception.impact.noWorkspace', language)}</span>
              )}
            </div>
          ) : (
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={t('perception.impact.manualInputPlaceholder', language)}
              className="w-full min-h-[100px] text-[12px] font-mono bg-surface border border-border/60 rounded-lg p-3 text-text-primary focus:outline-none focus:border-accent resize-y custom-scrollbar"
            />
          )}
        </section>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-500">
                {t('perception.impact.loadError', language)}
              </div>
              <div className="text-[12px] text-red-500/70 mt-0.5 break-all">{error}</div>
            </div>
            <button
              onClick={() => void runAnalysis(false)}
              className="text-[12px] text-red-500 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-500/10"
            >
              <RefreshCw className="w-3 h-3" />
              {t('perception.impact.retry', language)}
            </button>
          </div>
        )}

        {/* 分析中 */}
        {analyzing && !error && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-sm text-text-muted">
              <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
              {t('perception.impact.analyzing', language)}
            </div>
          </div>
        )}

        {/* 结果展示 */}
        {!analyzing && !error && result && levelStyle && (
          <div className="space-y-5">
            {/* 总体影响 + 统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard
                icon={<Activity className="w-4 h-4" />}
                label={t('perception.impact.overallLevel', language)}
                value={t(levelStyle.label, language)}
                colorCls={levelStyle.cls}
              />
              <SummaryCard
                icon={<AlertTriangle className="w-4 h-4" />}
                label={t('perception.impact.impactedFiles', language)}
                value={String(result.totalImpactedFiles)}
                colorCls="bg-violet-500/10 text-violet-500"
              />
              <SummaryCard
                icon={<Network className="w-4 h-4" />}
                label={t('perception.impact.fileCount', language)}
                value={String(result.graphStats.fileCount)}
                colorCls="bg-cyan-500/10 text-cyan-500"
              />
              <SummaryCard
                icon={<Network className="w-4 h-4" />}
                label={t('perception.impact.edgeCount', language)}
                value={String(result.graphStats.edgeCount)}
                colorCls="bg-emerald-500/10 text-emerald-500"
              />
            </div>

            {/* 依赖图构建时间 */}
            <div className="text-[11px] text-text-muted flex items-center gap-2">
              <RefreshCw className="w-3 h-3" />
              {t('perception.impact.builtAt', language)}: {formatTime(result.graphStats.builtAt, language)}
            </div>

            {/* Git 伴随修改分析卡片（阶段9 s9-09） */}
            <CoModificationStatsCard
              projectPath={result.projectPath}
              language={language}
              embeddedStats={result.coModificationStats ?? null}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 影响文件树（左 2/3） */}
              <div className="lg:col-span-2 p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40">
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-4">
                  {t('perception.impact.callChain', language)}
                </h4>
                <ImpactFileTree
                  results={result.results}
                  language={language}
                  externalExpandAll={expandAllSignal}
                />
              </div>

              {/* 高风险文件（右 1/3） */}
              <div className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40">
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-4 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  {t('perception.impact.highRisk', language)}
                </h4>
                {result.highRiskFiles.length === 0 ? (
                  <div className="text-[12px] text-text-muted py-6 text-center">
                    {t('perception.impact.noResults', language)}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {result.highRiskFiles.map((f, idx) => (
                      <div
                        key={`${f.filePath}-${idx}`}
                        className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 hover:bg-red-500/10 transition-colors"
                      >
                        <div className="text-[12px] font-medium text-text-primary truncate">
                          {f.relativePath || f.filePath}
                        </div>
                        <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1">
                          <span>{t('perception.impact.impactedByCount', language)}:</span>
                          <strong className="text-red-500">{f.impactedByCount}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </OverlayDialog>
  )
}

/** 统计卡片子组件 */
function SummaryCard({
  icon,
  label,
  value,
  colorCls,
}: {
  icon: React.ReactNode
  label: string
  value: string
  colorCls: string
}) {
  return (
    <div className="p-4 rounded-xl bg-surface/30 border border-border/40 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colorCls}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text-muted uppercase tracking-wider">
          {label}
        </div>
        <div className="text-lg font-bold text-text-primary mt-0.5 truncate">
          {value}
        </div>
      </div>
    </div>
  )
}
