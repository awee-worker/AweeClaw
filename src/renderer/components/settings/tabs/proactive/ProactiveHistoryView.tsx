/**
 * 主动助手 - 历史记录与统计子面板（s10-07）
 *
 * 职责：
 * 1. 展示采纳率统计（整体 + 按来源/按严重度细分）
 * 2. 分页查询提案历史列表
 * 3. 支持清空历史
 *
 * 只读视图，不涉及配置保存。
 *
 * @module settings/tabs/proactive/ProactiveHistoryView
 */

import { memo, useState, useEffect, useCallback } from 'react'
import {
  History,
  TrendingUp,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface Props {
  language: Language
}

// ============================================================
// 类型定义（与 IPC 返回结构对齐）
// ============================================================

interface ProactiveProposal {
  id: string
  source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
  trigger: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  action: { type: 'notify' | 'suggest' | 'chat' | 'execute'; payload: string }
  confidence: number
  reason: string
  signals: string[]
  dedupKey: string
  createdAt: number
}

interface AdoptionStats {
  total: number
  accepted: number
  rejected: number
  later: number
  ignored: number
  adoptionRate: number
  bySource: Record<string, { total: number; accepted: number; rate: number }>
  bySeverity: Record<string, { total: number; accepted: number; rate: number }>
}

// ============================================================
// 常量
// ============================================================

const PAGE_SIZE = 10

/** severity 样式 */
const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-blue-500/15 text-blue-400',
  low: 'bg-cyan-500/15 text-cyan-400',
  medium: 'bg-amber-500/15 text-amber-400',
  high: 'bg-orange-500/15 text-orange-400',
  critical: 'bg-red-500/15 text-red-400',
}

// ============================================================
// 组件
// ============================================================

export const ProactiveHistoryView = memo(function ProactiveHistoryView({
  language,
}: Props) {
  const [stats, setStats] = useState<AdoptionStats | null>(null)
  const [proposals, setProposals] = useState<ProactiveProposal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)

  // ===== 加载统计 =====
  const loadStats = useCallback(async () => {
    try {
      const result = await window.electronAPI.proactive.getStats()
      if (result.success && result.data) {
        setStats(result.data as AdoptionStats)
      }
    } catch (e) {
      logger.settings.error('[ProactiveHistoryView] 加载统计失败:', e)
    }
  }, [])

  // ===== 加载提案历史 =====
  const loadProposals = useCallback(async (pageNum: number) => {
    try {
      const result = await window.electronAPI.proactive.listProposals({
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
        sort: 'desc',
      })
      if (result.success && result.data) {
        setProposals(result.data.items as ProactiveProposal[])
        setTotal(result.data.total)
      }
    } catch (e) {
      logger.settings.error('[ProactiveHistoryView] 加载历史失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
    loadProposals(0)
  }, [loadStats, loadProposals])

  const handlePageChange = (newPage: number) => {
    if (newPage < 0 || newPage * PAGE_SIZE >= total) return
    setPage(newPage)
    loadProposals(newPage)
  }

  // ===== 清空历史 =====
  const handleClearHistory = async () => {
    setClearing(true)
    try {
      const result = await window.electronAPI.proactive.clearHistory()
      if (result.success) {
        setProposals([])
        setTotal(0)
        setStats(null)
        setPage(0)
      }
    } catch (e) {
      logger.settings.error('[ProactiveHistoryView] 清空历史失败:', e)
    } finally {
      setClearing(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* 统计概览 */}
      {stats && stats.total > 0 && (
        <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-medium text-text-primary">
                {t('settings.proactive.stats.title', language)}
              </h3>
            </div>
            <span className="text-[12px] text-text-muted">
              {t('settings.proactive.stats.total', language)}: {stats.total}
            </span>
          </div>

          {/* 整体采纳率 */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <StatCard
              label={t('settings.proactive.stats.accepted', language)}
              value={stats.accepted}
              color="text-green-400"
            />
            <StatCard
              label={t('settings.proactive.stats.rejected', language)}
              value={stats.rejected}
              color="text-red-400"
            />
            <StatCard
              label={t('settings.proactive.stats.later', language)}
              value={stats.later}
              color="text-text-muted"
            />
            <StatCard
              label={t('settings.proactive.stats.ignored', language)}
              value={stats.ignored}
              color="text-text-muted/60"
            />
          </div>

          {/* 采纳率进度条 */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-text-muted shrink-0">
              {t('settings.proactive.stats.adoptionRate', language)}
            </span>
            <div className="flex-1 h-2 rounded-full bg-surface-active/50 overflow-hidden">
              <div
                className="h-full bg-green-500/60 rounded-full transition-all"
                style={{ width: `${Math.round(stats.adoptionRate * 100)}%` }}
              />
            </div>
            <span className="text-[13px] font-semibold text-green-400 shrink-0">
              {Math.round(stats.adoptionRate * 100)}%
            </span>
          </div>
        </section>
      )}

      {/* 历史列表 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-text-muted" />
            <h3 className="text-sm font-medium text-text-primary">
              {t('settings.proactive.history.title', language)}
            </h3>
          </div>
          {total > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={clearing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('settings.proactive.history.clear', language)}
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-text-muted">
            {t('settings.loadingSettings', language)}
          </div>
        ) : proposals.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">
            {t('settings.proactive.history.empty', language)}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {proposals.map((proposal) => (
                <ProposalItem key={proposal.id} proposal={proposal} language={language} />
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-active/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] text-text-muted">
                  {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-active/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
})

// ============================================================
// 子组件：统计卡片
// ============================================================

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="p-2 rounded-lg bg-surface/60 border border-border/30 text-center">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[12px] text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

// ============================================================
// 子组件：提案项
// ============================================================

function ProposalItem({
  proposal,
  language,
}: {
  proposal: ProactiveProposal
  language: Language
}) {
  const [expanded, setExpanded] = useState(false)
  const severityColor = SEVERITY_COLORS[proposal.severity] ?? SEVERITY_COLORS.medium

  return (
    <div
      className="p-3 rounded-lg border border-border/40 bg-surface/30 hover:bg-surface/50 transition-colors cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[12px] px-1.5 py-0.5 rounded-full font-medium ${severityColor}`}>
              {t(`proactive.card.severity.${proposal.severity}`, language)}
            </span>
            <span className="text-[12px] text-text-muted">
              {t(`proactive.card.source.${proposal.source}`, language)}
            </span>
            <span className="text-[12px] text-text-muted/60">
              {new Date(proposal.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
            </span>
          </div>
          <div className="text-[13px] font-medium text-text-primary truncate">
            {proposal.title}
          </div>
          {!expanded && (
            <div className="text-[12px] text-text-muted truncate mt-0.5">
              {proposal.description}
            </div>
          )}
        </div>
        <div className="shrink-0 text-[12px] text-text-muted">
          {Math.round(proposal.confidence * 100)}%
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
          <div className="text-[12px] text-text-secondary">{proposal.description}</div>
          {proposal.reason && (
            <div className="text-[12px] text-text-muted">
              <span className="font-medium">{t('proactive.card.reason', language)}:</span>{' '}
              {proposal.reason}
            </div>
          )}
          <div className="text-[12px] text-text-muted">
            <span className="font-medium">{t('proactive.card.actionPayload', language)}:</span>{' '}
            <code className="font-mono bg-black/20 rounded px-1 break-all">
              {proposal.action.payload}
            </code>
          </div>
          {proposal.signals.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {proposal.signals.map((sig, i) => (
                <span
                  key={`${sig}-${i}`}
                  className="text-[12px] px-1.5 py-0.5 rounded bg-black/20 text-text-muted"
                >
                  {sig}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
