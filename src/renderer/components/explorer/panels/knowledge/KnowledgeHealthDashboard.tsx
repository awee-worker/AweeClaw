import { useMemo } from 'react'
import { X, Activity, Database, Zap, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { type KnowledgeEntry, KNOWLEDGE_CATEGORIES } from '@intelligence/runtime/knowledgeService/providerTypes'
import { t, type Language } from '@renderer/i18n'

interface HealthDashboardProps {
  entries: KnowledgeEntry[]
  language: Language
  onClose: () => void
}

interface HealthScore {
  label: string
  labelEn: string
  score: number
  maxScore: number
  status: 'good' | 'warning' | 'critical'
  detail: string
  detailEn: string
}

function computeHealthScores(entries: KnowledgeEntry[]): HealthScore[] {
  const total = entries.length
  const enabled = entries.filter((e) => e.enabled).length
  const withTags = entries.filter((e) => e.tags.length > 0).length
  const withCategory = entries.filter((e) => e.category).length
  const shortContent = entries.filter((e) => e.content.length < 20).length
  const duplicateContent = total - new Set(entries.map((e) => e.content.trim())).size

  const enabledRatio = total > 0 ? enabled / total : 1
  const tagRatio = total > 0 ? withTags / total : 0
  const categoryRatio = total > 0 ? withCategory / total : 0
  const qualityRatio = total > 0 ? (total - shortContent - duplicateContent) / total : 1

  return [
    {
      label: '覆盖率',
      labelEn: 'Coverage',
      score: Math.round(enabledRatio * 25),
      maxScore: 25,
      status: enabledRatio >= 0.8 ? 'good' : enabledRatio >= 0.5 ? 'warning' : 'critical',
      detail: `${enabled}/${total} 条目已启用`,
      detailEn: `${enabled}/${total} entries enabled`,
    },
    {
      label: '标签完整度',
      labelEn: 'Tag Completeness',
      score: Math.round(tagRatio * 25),
      maxScore: 25,
      status: tagRatio >= 0.7 ? 'good' : tagRatio >= 0.4 ? 'warning' : 'critical',
      detail: `${withTags}/${total} 条目有标签`,
      detailEn: `${withTags}/${total} entries tagged`,
    },
    {
      label: '分类完整度',
      labelEn: 'Category Completeness',
      score: Math.round(categoryRatio * 25),
      maxScore: 25,
      status: categoryRatio >= 0.7 ? 'good' : categoryRatio >= 0.4 ? 'warning' : 'critical',
      detail: `${withCategory}/${total} 条目已分类`,
      detailEn: `${withCategory}/${total} entries categorized`,
    },
    {
      label: '内容质量',
      labelEn: 'Content Quality',
      score: Math.round(qualityRatio * 25),
      maxScore: 25,
      status: qualityRatio >= 0.8 ? 'good' : qualityRatio >= 0.5 ? 'warning' : 'critical',
      detail: `${shortContent} 过短, ${duplicateContent} 重复`,
      detailEn: `${shortContent} short, ${duplicateContent} duplicates`,
    },
  ]
}

export function HealthDashboard({ entries, language, onClose }: HealthDashboardProps) {
  const scores = useMemo(() => computeHealthScores(entries), [entries])
  const totalScore = scores.reduce((s, h) => s + h.score, 0)
  const overallStatus = totalScore >= 80 ? 'good' : totalScore >= 50 ? 'warning' : 'critical'

  const categoryStats = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      const cat = e.category || 'uncategorized'
      map.set(cat, (map.get(cat) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([id, count]) => {
        const config = KNOWLEDGE_CATEGORIES.find((c) => c.id === id)
        return { id, name: language === 'zh' ? (config?.labelZh || id) : (config?.labelEn || id), count }
      })
      .sort((a, b) => b.count - a.count)
  }, [entries, language])

  const sourceStats = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      map.set(e.source, (map.get(e.source) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
  }, [entries])

  const recentEntries = useMemo(() => {
    return [...entries]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  }, [entries])

  const statusIcon = (status: string) => {
    if (status === 'good') return <CheckCircle2 className="w-4 h-4 text-green-500" />
    if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />
    return <AlertTriangle className="w-4 h-4 text-red-500" />
  }

  const scoreColor = (status: string) => {
    if (status === 'good') return 'text-green-500'
    if (status === 'warning') return 'text-amber-500'
    return 'text-red-500'
  }

  const barColor = (status: string) => {
    if (status === 'good') return 'bg-green-500'
    if (status === 'warning') return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between flex-shrink-0">
        <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          {t('app.knowledgehealth', language as Language)}
        </h3>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
        <div className="flex items-center justify-center gap-6 py-4">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke={overallStatus === 'good' ? '#22c55e' : overallStatus === 'warning' ? '#f59e0b' : '#ef4444'}
                strokeWidth="8"
                strokeDasharray={`${(totalScore / 100) * 264} 264`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${scoreColor(overallStatus)}`}>{totalScore}</span>
              <span className="text-[10px] text-text-muted">{t('app.score', language as Language)}</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-text-primary">
              {t('app.overallhealth', language as Language)}
            </p>
            <p className={`text-[12px] ${scoreColor(overallStatus)}`}>
              {overallStatus === 'good' ? t('app.good', language as Language) : overallStatus === 'warning' ? t('app.needsattention', language as Language) : t('app.needsimprovement', language as Language)}
            </p>
            <p className="text-[11px] text-text-muted">
              {t('app.entries', language as Language, { length: entries.length })}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {scores.map((s) => (
            <div key={s.label} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {statusIcon(s.status)}
                  <span className="text-[12px] text-text-primary">{language === 'zh' ? s.label : s.labelEn}</span>
                </div>
                <span className={`text-[12px] font-medium ${scoreColor(s.status)}`}>
                  {s.score}/{s.maxScore}
                </span>
              </div>
              <div className="h-1.5 bg-surface/30 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor(s.status)}`}
                  style={{ width: `${(s.score / s.maxScore) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-text-muted">{language === 'zh' ? s.detail : s.detailEn}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface/30 rounded-lg p-3 border border-border/20">
            <div className="flex items-center gap-1.5 mb-2">
              <Database className="w-3.5 h-3.5 text-accent" />
              <span className="text-[11px] font-medium text-text-primary">{t('app.categories', language as Language)}</span>
            </div>
            <div className="space-y-1.5">
              {categoryStats.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted truncate max-w-[80px]">{c.name}</span>
                  <span className="text-[10px] text-text-secondary font-medium">{c.count}</span>
                </div>
              ))}
              {categoryStats.length === 0 && (
                <p className="text-[10px] text-text-muted">{t('app.nodata', language as Language)}</p>
              )}
            </div>
          </div>

          <div className="bg-surface/30 rounded-lg p-3 border border-border/20">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="w-3.5 h-3.5 text-accent" />
              <span className="text-[11px] font-medium text-text-primary">{t('app.sources', language as Language)}</span>
            </div>
            <div className="space-y-1.5">
              {sourceStats.slice(0, 5).map((s) => (
                <div key={s.source} className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted truncate max-w-[80px]">{s.source}</span>
                  <span className="text-[10px] text-text-secondary font-medium">{s.count}</span>
                </div>
              ))}
              {sourceStats.length === 0 && (
                <p className="text-[10px] text-text-muted">{t('app.nodata2', language as Language)}</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-surface/30 rounded-lg p-3 border border-border/20">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
            <span className="text-[11px] font-medium text-text-primary">{t('app.recentupdates', language as Language)}</span>
          </div>
          <div className="space-y-1.5">
            {recentEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted truncate max-w-[160px]">{e.title || e.content.slice(0, 30)}</span>
                <span className="text-[10px] text-text-muted">
                  {new Date(e.updatedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
            {recentEntries.length === 0 && (
              <p className="text-[10px] text-text-muted">{t('app.nodata3', language as Language)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
