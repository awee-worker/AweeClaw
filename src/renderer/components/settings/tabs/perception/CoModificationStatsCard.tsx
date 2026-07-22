/**
 * 伴随修改分析统计卡片（阶段9 s9-09）
 *
 * 展示 Git 伴随修改分析的统计信息：
 * - 分析提交数 / 涉及文件数 / 文件对数
 * - 命中缓存标记
 * - 分析时间
 * - 刷新 / 清空缓存按钮
 *
 * 数据源：window.electronAPI.perception.analyzeCoModification / getCoModificationStats
 *
 * @module settings/tabs/perception/CoModificationStatsCard
 */

import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, Trash2, GitCommit, FileBox, Link2, Database } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface CoModificationStatsCardProps {
  /** 项目根路径 */
  projectPath: string
  /** 语言 */
  language: Language
  /** 外部传入的统计（来自 analyzeImpact 结果，可为 null） */
  embeddedStats?: {
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analyzedAt: number
    fromCache: boolean
  } | null
}

/** 统计信息 */
interface Stats {
  totalCommits: number
  uniqueFiles: number
  uniqueFilePairs: number
  analyzedAt: number
  fromCache: boolean
}

export function CoModificationStatsCard({
  projectPath,
  language,
  embeddedStats,
}: CoModificationStatsCardProps) {
  const [stats, setStats] = useState<Stats | null>(embeddedStats ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 刷新分析（强制刷新缓存） */
  const handleRefresh = useCallback(async () => {
    if (!projectPath) return
    setRefreshing(true)
    setError(null)
    try {
      const result = await window.electronAPI.perception.analyzeCoModification(projectPath, {
        forceRefresh: true,
      })
      if (result.success && result.data) {
        setStats({
          totalCommits: result.data.totalCommits,
          uniqueFiles: result.data.uniqueFiles,
          uniqueFilePairs: result.data.uniqueFilePairs,
          analyzedAt: result.data.analyzedAt,
          fromCache: result.data.fromCache,
        })
      } else {
        setError(result.error ?? t('perception.impact.coModification.analyzeFailed', language))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('[CoModificationStatsCard] 刷新失败:', e)
    } finally {
      setRefreshing(false)
    }
  }, [projectPath, language])

  /** 清空缓存 */
  const handleClearCache = useCallback(async () => {
    if (!projectPath) return
    setClearing(true)
    setError(null)
    try {
      const result = await window.electronAPI.perception.clearCoModificationCache(projectPath)
      if (result.success) {
        setStats(null)
      } else {
        setError(result.error ?? t('perception.impact.coModification.analyzeFailed', language))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('[CoModificationStatsCard] 清空缓存失败:', e)
    } finally {
      setClearing(false)
    }
  }, [projectPath, language])

  // 当 embeddedStats 变化时同步（analyzeImpact 完成后自动更新）
  useEffect(() => {
    if (embeddedStats) {
      setStats(embeddedStats)
    }
  }, [embeddedStats])

  return (
    <div className="p-4 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/40 space-y-3">
      {/* 标题 + 操作按钮 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-cyan-500" />
          <h4 className="text-[12px] font-semibold text-text-primary">
            {t('perception.impact.coModification.title', language)}
          </h4>
          {stats && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                stats.fromCache
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}
            >
              {stats.fromCache
                ? t('perception.impact.coModification.fromCache.yes', language)
                : t('perception.impact.coModification.fromCache.no', language)}
            </span>
          )}
        </div>

        {projectPath && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing || clearing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={t('perception.impact.coModification.refresh', language)}
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing
                ? t('perception.impact.coModification.refreshing', language)
                : t('perception.impact.coModification.refresh', language)}
            </button>
            <button
              onClick={() => void handleClearCache()}
              disabled={refreshing || clearing || !stats}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={t('perception.impact.coModification.clearCache', language)}
            >
              <Trash2 className={`w-3 h-3 ${clearing ? 'animate-spin' : ''}`} />
              {t('perception.impact.coModification.clearCache', language)}
            </button>
          </div>
        )}
      </div>

      {/* 副标题 */}
      <p className="text-[12px] text-text-muted">
        {t('perception.impact.coModification.subtitle', language)}
      </p>

      {/* 错误提示 */}
      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500">
          {error}
        </div>
      )}

      {/* 统计卡片 */}
      {!stats ? (
        <div className="text-center py-4 text-text-muted text-[12px]">
          {projectPath
            ? t('perception.impact.coModification.notAnalyzed', language)
            : t('perception.impact.coModification.noData', language)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<GitCommit className="w-3.5 h-3.5" />}
            label={t('perception.impact.coModification.totalCommits', language)}
            value={String(stats.totalCommits)}
            colorCls="bg-cyan-500/10 text-cyan-500"
          />
          <StatCard
            icon={<FileBox className="w-3.5 h-3.5" />}
            label={t('perception.impact.coModification.uniqueFiles', language)}
            value={String(stats.uniqueFiles)}
            colorCls="bg-violet-500/10 text-violet-500"
          />
          <StatCard
            icon={<Link2 className="w-3.5 h-3.5" />}
            label={t('perception.impact.coModification.uniqueFilePairs', language)}
            value={String(stats.uniqueFilePairs)}
            colorCls="bg-emerald-500/10 text-emerald-500"
          />
          <StatCard
            icon={<Database className="w-3.5 h-3.5" />}
            label={t('perception.impact.coModification.analyzedAt', language)}
            value={formatTime(stats.analyzedAt, language)}
            colorCls="bg-amber-500/10 text-amber-500"
          />
        </div>
      )}
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({
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
    <div className="p-3 rounded-xl bg-surface/30 border border-border/40 flex items-start gap-2.5">
      <div className={`p-1.5 rounded-lg ${colorCls}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text-muted uppercase tracking-wider truncate">
          {label}
        </div>
        <div className="text-sm font-bold text-text-primary mt-0.5 truncate">
          {value}
        </div>
      </div>
    </div>
  )
}

/** 格式化时间戳 */
function formatTime(ts: number, language: Language): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return language === 'zh' ? `${month}-${day} ${hh}:${mm}` : `${month}/${day} ${hh}:${mm}`
}
