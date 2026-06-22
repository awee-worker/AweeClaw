/**
 * 记忆健康报告
 * 评估记忆系统的整体健康状况，给出建议
 */
import { useEffect, useMemo } from 'react'
import {
  Heart,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Lightbulb,
  RefreshCw,
} from 'lucide-react'
import { useMemoryStore } from '../store'
import { memoryApi } from '../api'
import { LoadingState } from './shared'

interface HealthReport {
  score: number
  level: 'excellent' | 'good' | 'fair' | 'poor'
  issues: Array<{
    type: 'warning' | 'info' | 'success'
    title: string
    description: string
    suggestion?: string
  }>
  recommendations: string[]
}

export function MemoryHealthReport() {
  const {
    overview,
    forgettingStats,
    fetchOverview,
    fetchForgettingStats,
  } = useMemoryStore()

  useEffect(() => {
    fetchOverview()
    fetchForgettingStats()
  }, [fetchOverview, fetchForgettingStats])

  // 计算健康报告
  const report: HealthReport | null = useMemo(() => {
    if (!overview || !forgettingStats) return null

    const total = overview.total || 1
    const activeRate = overview.active / total
    const forgottenRate = overview.forgotten / total
    const expiredRate = (forgettingStats.expired ?? 0) / total

    // 分类覆盖度
    const categoryCount = overview.byCategory?.filter((c) => c.count > 0).length ?? 0
    const categoryCoverage = categoryCount / 8

    // 平均重要性
    const avgImportance =
      overview.byCategory && overview.byCategory.length > 0
        ? overview.byCategory.reduce((sum, c) => sum + (c.avgImportance ?? 0) * c.count, 0) / total
        : 0

    // 平均保留值
    const avgRetention =
      overview.byTier && overview.byTier.length > 0
        ? overview.byTier.reduce((sum, t) => sum + (t.avgRetention ?? 0) * t.count, 0) / total
        : 0

    // 计算综合得分（0-100）
    let score = 0
    score += activeRate * 30 // 活跃度权重 30
    score += avgRetention * 25 // 保留值权重 25
    score += avgImportance * 20 // 重要性权重 20
    score += categoryCoverage * 15 // 分类覆盖权重 15
    score += (1 - expiredRate) * 10 // 过期率权重 10
    score = Math.round(Math.max(0, Math.min(100, score * 100)))

    const level: HealthReport['level'] =
      score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor'

    // 识别问题
    const issues: HealthReport['issues'] = []
    const recommendations: string[] = []

    if (expiredRate > 0.1) {
      issues.push({
        type: 'warning',
        title: '过期记忆堆积',
        description: `${forgettingStats.expired} 条记忆已过期未清理（占比 ${(expiredRate * 100).toFixed(0)}%）`,
        suggestion: '运行遗忘引擎清理过期记忆',
      })
      recommendations.push('点击"运行遗忘引擎"清理过期记忆')
    }

    if (forgottenRate > 0.5) {
      issues.push({
        type: 'warning',
        title: '遗忘率过高',
        description: `${overview.forgotten} 条记忆已被遗忘（占比 ${(forgottenRate * 100).toFixed(0)}%）`,
        suggestion: '考虑提高重要记忆的重要性评分，或增加复习频率',
      })
      recommendations.push('对重要记忆进行复习，提升保留值')
    }

    if (categoryCoverage < 0.5) {
      issues.push({
        type: 'info',
        title: '分类覆盖不足',
        description: `仅覆盖 ${categoryCount} 个分类（共 8 个）`,
        suggestion: '尝试在更多场景下使用 AI 助手以丰富记忆类型',
      })
      recommendations.push('多使用 AI 助手记录不同类型的信息')
    }

    if (avgImportance < 0.4) {
      issues.push({
        type: 'info',
        title: '平均重要性偏低',
        description: `平均重要性为 ${(avgImportance * 100).toFixed(0)}%`,
        suggestion: '可手动调整重要记忆的重要性评分',
      })
      recommendations.push('提升关键记忆的重要性评分')
    }

    if (avgRetention < 0.5) {
      issues.push({
        type: 'warning',
        title: '平均保留值偏低',
        description: `平均保留值为 ${(avgRetention * 100).toFixed(0)}%`,
        suggestion: '定期复习重要记忆以提升保留值',
      })
      recommendations.push('定期复习重要记忆')
    }

    if (activeRate > 0.8 && expiredRate < 0.05) {
      issues.push({
        type: 'success',
        title: '记忆系统运行良好',
        description: `活跃记忆占比 ${(activeRate * 100).toFixed(0)}%，过期记忆占比极低`,
      })
    }

    if (recommendations.length === 0) {
      recommendations.push('继续保持良好的记忆管理习惯')
      recommendations.push('定期查看统计面板了解记忆分布')
    }

    return { score, level, issues, recommendations }
  }, [overview, forgettingStats])

  // 手动触发遗忘引擎
  const handleRunEngine = async () => {
    try {
      await memoryApi.forgetting.runEngine()
      await fetchForgettingStats()
      await fetchOverview()
    } catch (err) {
      console.error('运行遗忘引擎失败', err)
    }
  }

  if (!report) {
    return <LoadingState message="生成健康报告..." />
  }

  const levelMeta = {
    excellent: { label: '优秀', color: '#10B981', bg: 'bg-green-500/10' },
    good: { label: '良好', color: '#3B82F6', bg: 'bg-blue-500/10' },
    fair: { label: '一般', color: '#F59E0B', bg: 'bg-amber-500/10' },
    poor: { label: '不佳', color: '#EF4444', bg: 'bg-red-500/10' },
  }
  const meta = levelMeta[report.level]

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar p-4 space-y-4">
      {/* 总体得分 */}
      <div className={`rounded-xl border border-border/30 p-5 ${meta.bg}`}>
        <div className="flex items-center gap-4">
          {/* 得分环 */}
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-surface-hover"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={meta.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(report.score / 100) * 264} 264`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold" style={{ color: meta.color }}>
                {report.score}
              </span>
              <span className="text-[9px] text-text-muted">分</span>
            </div>
          </div>
          {/* 等级与说明 */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Heart className="w-4 h-4" style={{ color: meta.color }} />
              <h3 className="text-base font-semibold text-text-primary">记忆健康状况</h3>
            </div>
            <div
              className="inline-block px-2 py-0.5 rounded text-xs font-medium mb-2"
              style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
            >
              {meta.label}
            </div>
            <p className="text-xs text-text-muted">
              {report.level === 'excellent' && '记忆系统运行优秀，继续保持！'}
              {report.level === 'good' && '记忆系统运行良好，有小幅优化空间'}
              {report.level === 'fair' && '记忆系统状态一般，建议关注以下问题'}
              {report.level === 'poor' && '记忆系统状态不佳，需要及时处理'}
            </p>
          </div>
        </div>
      </div>

      {/* 问题列表 */}
      <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-accent" />
          诊断结果
        </h3>
        <div className="space-y-2">
          {report.issues.map((issue, i) => (
            <IssueItem key={i} issue={issue} />
          ))}
        </div>
      </div>

      {/* 建议 */}
      <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          优化建议
        </h3>
        <ul className="space-y-2">
          {report.recommendations.map((rec, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
              <span className="w-4 h-4 rounded-full bg-accent/10 text-accent flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{rec}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 快速操作 */}
      <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-accent" />
          快速操作
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRunEngine}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            运行遗忘引擎
          </button>
          <button
            onClick={async () => {
              await memoryApi.forgetting.cleanupExpired()
              fetchForgettingStats()
              fetchOverview()
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <TrendingDown className="w-3 h-3" />
            清理过期记忆
          </button>
        </div>
      </div>
    </div>
  )
}

function IssueItem({
  issue,
}: {
  issue: HealthReport['issues'][number]
}) {
  const config = {
    warning: { icon: AlertCircle, color: '#F59E0B' },
    info: { icon: TrendingUp, color: '#3B82F6' },
    success: { icon: CheckCircle2, color: '#10B981' },
  }
  const cfg = config[issue.type]
  const Icon = cfg.icon

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-surface-hover/20">
      <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: cfg.color }} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary">{issue.title}</div>
        <div className="text-[11px] text-text-muted mt-0.5">{issue.description}</div>
        {issue.suggestion && (
          <div className="text-[11px] text-accent mt-1">建议: {issue.suggestion}</div>
        )}
      </div>
    </div>
  )
}
