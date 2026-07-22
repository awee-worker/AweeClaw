/**
 * 场景时间轴主视图
 *
 * 全屏弹窗，整合热力图、统计卡片、场景列表。
 * 用户在 PerceptionSettingsPanel 中点击「查看时间轴」按钮打开。
 *
 * 数据来源：
 * - getSceneTimeline: 获取指定时间范围内的场景列表
 * - getBehaviorHeatmap: 获取行为热力图聚合数据
 *
 * 交互特性：
 * - 7/14/30 天时间范围切换
 * - 顶部统计卡片（场景数/行为数/高峰时段/主要活动）
 * - 热力图区域（左）+ 场景列表（右）双栏布局
 * - 错误重试
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Calendar, Activity, Clock, TrendingUp, AlertCircle, RefreshCw } from 'lucide-react'
import { OverlayDialog } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import type { SceneTimelineItem, BehaviorHeatmapCell } from '@main/preload/api/perception'
import { BehaviorHeatmap } from './BehaviorHeatmap'
import { SceneListPanel } from './SceneListPanel'

interface SceneTimelineViewProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
}

/** 时间范围选项 */
type TimeRange = 7 | 14 | 30

/** 统计数据 */
interface TimelineStats {
  totalScenes: number
  totalBehaviors: number
  peakHour: number | null
  topActivity: string | null
}

export function SceneTimelineView({
  isOpen,
  onClose,
  language,
}: SceneTimelineViewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(14)
  const [scenes, setScenes] = useState<SceneTimelineItem[]>([])
  const [heatmap, setHeatmap] = useState<BehaviorHeatmapCell[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 加载时间轴数据 */
  const loadData = useCallback(async (range: TimeRange) => {
    setLoading(true)
    setError(null)

    try {
      const now = Date.now()
      const startTime = now - range * 24 * 60 * 60 * 1000

      const [sceneRes, heatmapRes] = await Promise.all([
        window.electronAPI.perception.getSceneTimeline(startTime, now, 500),
        window.electronAPI.perception.getBehaviorHeatmap(range),
      ])

      if (!sceneRes.success) {
        throw new Error(sceneRes.error || 'Failed to load scenes')
      }
      if (!heatmapRes.success) {
        throw new Error(heatmapRes.error || 'Failed to load heatmap')
      }

      setScenes((sceneRes.data ?? []) as SceneTimelineItem[])
      setHeatmap((heatmapRes.data ?? []) as BehaviorHeatmapCell[])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.settings?.error('[SceneTimelineView] 加载失败:', e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载 + 时间范围切换重新加载
  useEffect(() => {
    if (isOpen) {
      void loadData(timeRange)
    }
  }, [isOpen, timeRange, loadData])

  // 统计数据计算
  const stats = useMemo<TimelineStats>(() => {
    let totalBehaviors = 0
    const hourCounts = new Map<number, number>()
    const activityCounts = new Map<string, number>()

    for (const cell of heatmap) {
      totalBehaviors += cell.count
      hourCounts.set(cell.hour, (hourCounts.get(cell.hour) ?? 0) + cell.count)
      if (cell.count > 0) {
        activityCounts.set(cell.topActivity, (activityCounts.get(cell.topActivity) ?? 0) + cell.count)
      }
    }

    let peakHour: number | null = null
    let peakCount = 0
    for (const [hour, count] of hourCounts.entries()) {
      if (count > peakCount) {
        peakCount = count
        peakHour = hour
      }
    }

    let topActivity: string | null = null
    let topCount = 0
    for (const [activity, count] of activityCounts.entries()) {
      if (count > topCount) {
        topCount = count
        topActivity = activity
      }
    }

    return {
      totalScenes: scenes.length,
      totalBehaviors,
      peakHour,
      topActivity,
    }
  }, [scenes, heatmap])

  const timeRangeOptions: Array<{ value: TimeRange; labelKey: string }> = [
    { value: 7, labelKey: 'perception.timeline.last7days' },
    { value: 14, labelKey: 'perception.timeline.last14days' },
    { value: 30, labelKey: 'perception.timeline.last30days' },
  ]

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('perception.timeline.title', language)}
      size="full"
      noPadding
    >
      <div className="p-6 space-y-5">
        {/* 顶部说明 + 时间范围切换 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-text-primary">
              {t('perception.timeline.title', language)}
            </h3>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('perception.timeline.subtitle', language)}
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-surface/40 rounded-xl border border-border/40">
            {timeRangeOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  timeRange === opt.value
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                {t(opt.labelKey, language)}
              </button>
            ))}
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Calendar className="w-4 h-4" />}
            label={t('perception.timeline.totalScenes', language)}
            value={String(stats.totalScenes)}
            color="violet"
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label={t('perception.timeline.totalBehaviors', language)}
            value={String(stats.totalBehaviors)}
            color="cyan"
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label={t('perception.timeline.peakHour', language)}
            value={stats.peakHour !== null ? t('perception.timeline.hourFormat', language, { hour: String(stats.peakHour) }) : '-'}
            color="amber"
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label={t('perception.timeline.topActivity', language)}
            value={stats.topActivity ?? '-'}
            color="emerald"
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-500">
                {t('perception.timeline.loadError', language)}
              </div>
              <div className="text-[12px] text-red-500/70 mt-0.5 break-all">{error}</div>
            </div>
            <button
              onClick={() => void loadData(timeRange)}
              className="text-[12px] text-red-500 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-500/10"
            >
              <RefreshCw className="w-3 h-3" />
              {t('perception.timeline.retry', language)}
            </button>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-sm text-text-muted">
              <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
              {t('perception.timeline.loading', language)}
            </div>
          </div>
        )}

        {/* 主体内容：热力图 + 场景列表 */}
        {!loading && !error && (
          <div className="space-y-5">
            {/* 热力图区域 */}
            <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40">
              <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-4">
                {t('perception.timeline.heatmap', language)}
              </h4>
              <BehaviorHeatmap cells={heatmap} language={language} />
            </section>

            {/* 场景列表区域 */}
            <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40">
              <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 mb-4">
                {t('perception.timeline.scenes', language)}
              </h4>
              <SceneListPanel scenes={scenes} language={language} />
            </section>
          </div>
        )}
      </div>
    </OverlayDialog>
  )
}

/** 统计卡片子组件 */
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'violet' | 'cyan' | 'amber' | 'emerald'
}) {
  const colorClasses = {
    violet: 'bg-violet-500/10 text-violet-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    amber: 'bg-amber-500/10 text-amber-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
  }
  return (
    <div className="p-4 rounded-xl bg-surface/30 border border-border/40 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
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
