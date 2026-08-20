/**
 * 发布前预检查面板（PreChecklistPanel）
 *
 * 独立组件，被 PublishPanel 嵌入使用：
 *  - 触发 prePublishChecklistService.runChecks(project) 运行检查
 *  - 按分类（manifest/permissions/...）分组渲染检查项
 *  - 严重程度色块：critical 红 / warning 黄 / info 蓝 / pass 绿
 *  - 通过 onPublishableChange 回调通知父组件是否允许发布
 *
 * 设计要点：
 *  - 单列布局，适配侧边栏（minWidth 170 / maxWidth 600）
 *  - 字体 ≥ 12px，遵循 UI 设计规则
 *  - 折叠/展开检查项详情，避免长列表压垮界面
 *  - 检查中显示进度占位
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import { prePublishChecklistService } from '../../services'
import type { ChecklistResult, ChecklistItem, ChecklistCategory } from '../../services'
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
} from 'lucide-react'

// ==========================================
// 严重程度样式映射
// ==========================================

type SeverityStyle = {
  /** 徽章 className */
  badge: string
  /** 圆点 className */
  dot: string
  /** 图标 */
  Icon: React.ComponentType<{ className?: string }>
}

const SEVERITY_STYLE: Record<'critical' | 'warning' | 'info' | 'pass', SeverityStyle> = {
  critical: {
    badge: 'bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
    Icon: AlertCircle,
  },
  warning: {
    badge: 'bg-yellow-500/10 text-yellow-600',
    dot: 'bg-yellow-500',
    Icon: AlertTriangle,
  },
  info: {
    badge: 'bg-sky-500/10 text-sky-600',
    dot: 'bg-sky-500',
    Icon: Info,
  },
  pass: {
    badge: 'bg-emerald-500/10 text-emerald-600',
    dot: 'bg-emerald-500',
    Icon: CheckCircle2,
  },
}

/** 分类显示顺序 */
const CATEGORY_ORDER: ChecklistCategory[] = [
  'manifest',
  'permissions',
  'prompts',
  'dependencies',
  'database',
  'structure',
  'changelog',
  'license',
]

// ==========================================
// 主组件
// ==========================================

interface PreChecklistPanelProps {
  /** 检查结果变化时通知父组件（publishable 为 true 时允许发布） */
  onResultChange?: (result: ChecklistResult | null) => void
}

const PreChecklistPanel: React.FC<PreChecklistPanelProps> = ({ onResultChange }) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'
  const { project } = useSelectedProject()

  const [result, setResult] = useState<ChecklistResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>('')
  /** 展开的分类集合（按分类折叠） */
  const [expandedCategories, setExpandedCategories] = useState<Set<ChecklistCategory>>(new Set())
  /** 展开的检查项 ID 集合（查看修复建议） */
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  // ==========================================
  // 运行检查
  // ==========================================

  const runChecks = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError('')
    try {
      const r = await prePublishChecklistService.runChecks(project)
      setResult(r)
      // 默认展开所有有 fail 项的分类
      const failCats = new Set<ChecklistCategory>(
        r.items.filter((i) => i.status === 'fail').map((i) => i.category),
      )
      setExpandedCategories(failCats)
      onResultChange?.(r)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }, [project, onResultChange])

  // 项目切换时清空旧结果
  useEffect(() => {
    setResult(null)
    setError('')
    setExpandedCategories(new Set())
    setExpandedItems(new Set())
    onResultChange?.(null)
  }, [project?.id, onResultChange])

  // ==========================================
  // 交互处理
  // ==========================================

  const toggleCategory = (cat: ChecklistCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const toggleItem = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ==========================================
  // 按分类分组
  // ==========================================

  const groupedItems = (items: ChecklistItem[]): Array<{ category: ChecklistCategory; items: ChecklistItem[] }> => {
    const map = new Map<ChecklistCategory, ChecklistItem[]>()
    for (const cat of CATEGORY_ORDER) {
      const filtered = items.filter((i) => i.category === cat)
      if (filtered.length > 0) map.set(cat, filtered)
    }
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
  }

  // ==========================================
  // 渲染
  // ==========================================

  return (
    <div className="flex flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">
            {t('builder.precheck.title')}
          </h3>
        </div>
        <button
          onClick={runChecks}
          disabled={!project || running}
          className="flex items-center gap-1.5 rounded border border-border bg-surface/40 px-2 py-1 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {result ? t('builder.precheck.rerun') : t('builder.precheck.run')}
        </button>
      </div>

      {/* 检查中占位 */}
      {running && (
        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          {t('builder.precheck.running')}
        </div>
      )}

      {/* 错误 */}
      {error && !running && (
        <div className="m-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {/* 空状态 */}
      {!result && !running && !error && (
        <div className="py-6 text-center text-[12px] text-text-muted">
          {t('builder.precheck.empty')}
        </div>
      )}

      {/* 检查结果汇总 */}
      {result && !running && (
        <>
          <div
            className={`flex items-center gap-2 px-3 py-2 text-[12px] font-medium ${
              result.publishable
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {result.publishable ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            <span>{result.publishable ? t('builder.precheck.publishable') : t('builder.precheck.blocked')}</span>
          </div>

          <div className="px-3 py-1.5 text-[12px] text-text-muted">
            {t('builder.precheck.summary')
              .replace('{pass}', String(result.passCount))
              .replace('{warning}', String(result.warningCount))
              .replace('{critical}', String(result.criticalCount))
              .replace('{skipped}', String(result.skippedCount))}
          </div>

          {/* 分组列表 */}
          <div className="flex-1 overflow-y-auto">
            {groupedItems(result.items).map(({ category, items }) => {
              const expanded = expandedCategories.has(category)
              const failCount = items.filter((i) => i.status === 'fail').length
              return (
                <div key={category} className="border-b border-border">
                  {/* 分类标题 */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
                  >
                    {expanded ? <ChevronDown className="w-3 h-3 text-text-muted" /> : <ChevronRight className="w-3 h-3 text-text-muted" />}
                    <span className="text-[12px] font-medium text-text-primary">
                      {t(`builder.precheck.category.${category}`)}
                    </span>
                    {failCount > 0 && (
                      <span className="ml-auto rounded bg-destructive/10 px-1.5 py-0.5 text-[12px] text-destructive">
                        {failCount}
                      </span>
                    )}
                    {failCount === 0 && (
                      <CheckCircle2 className="ml-auto w-3 h-3 text-emerald-500" />
                    )}
                  </button>

                  {/* 分类下检查项 */}
                  {expanded && (
                    <ul className="px-3 pb-2 space-y-1">
                      {items.map((item) => {
                        const style = SEVERITY_STYLE[item.severity]
                        const Icon = style.Icon
                        const itemExpanded = expandedItems.has(item.id)
                        const hasDetail = item.detailZh || item.detail || item.fixSuggestionZh || item.fixSuggestion
                        return (
                          <li key={item.id} className="rounded border border-border/50 bg-surface/30">
                            <button
                              onClick={() => hasDetail && toggleItem(item.id)}
                              className={`flex w-full items-start gap-2 p-2 text-left ${hasDetail ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default'}`}
                            >
                              <Icon className={`mt-0.5 w-3.5 h-3.5 flex-shrink-0 ${style.badge.split(' ')[1]}`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] text-text-primary">
                                  {isZh ? item.labelZh : item.label}
                                </div>
                                {itemExpanded && hasDetail && (
                                  <div className="mt-1.5 space-y-1.5 text-[12px]">
                                    {((isZh ? item.detailZh : item.detail) || item.detail) && (
                                      <div className="text-text-secondary leading-relaxed">
                                        {isZh ? (item.detailZh || item.detail) : (item.detail || item.detailZh)}
                                      </div>
                                    )}
                                    {(isZh ? item.fixSuggestionZh : item.fixSuggestion) && (
                                      <div className="rounded bg-accent/5 px-2 py-1 text-text-secondary">
                                        <span className="font-medium text-accent">
                                          {t('builder.precheck.fix')}：
                                        </span>
                                        {isZh ? item.fixSuggestionZh : item.fixSuggestion}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {hasDetail && (
                                <span className="flex-shrink-0">
                                  {itemExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-text-muted" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-text-muted" />
                                  )}
                                </span>
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default PreChecklistPanel
