/**
 * 断言审核视图
 *
 * 展示从事件流抽取或用户上报的因果断言，并支持：
 * - 状态筛选（pending/approved/rejected/merged）
 * - 关键字搜索（源文本/因/果）
 * - 审核操作：通过（自动转化为边）/拒绝/合并
 * - 手动新增断言
 * - 从文本抽取（调用规则+LLM 抽取器）
 *
 * 数据来源：window.electronAPI.causal.{listAssertions,reportAssertion,
 *           reviewAssertion,extractAssertions}
 *
 * @module settings/tabs/causal/AssertionReviewView
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircle2,
  XCircle,
  GitMerge,
  Plus,
  Sparkles,
  AlertCircle,
  Search,
  Clock,
  X,
  ChevronRight,
} from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  CausalAssertion,
  AssertionReviewStatus,
  CausalEdgeRelation,
  AssertionExtractor,
  ExtractedAssertion,
} from '@main/preload/api/causalReasoning'

interface AssertionReviewViewProps {
  language: Language
}

/** 审核状态标签 */
const STATUS_LABELS: Record<AssertionReviewStatus, { zh: string; en: string; color: string; bg: string }> = {
  pending: {
    zh: '待审核',
    en: 'Pending',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  approved: {
    zh: '已通过',
    en: 'Approved',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  rejected: {
    zh: '已拒绝',
    en: 'Rejected',
    color: 'text-red-500',
    bg: 'bg-red-500/10',
  },
  merged: {
    zh: '已合并',
    en: 'Merged',
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
}

/** 关系标签 */
const RELATION_LABELS: Record<CausalEdgeRelation, { zh: string; en: string }> = {
  causes: { zh: '导致', en: 'Causes' },
  enables: { zh: '促进', en: 'Enables' },
  prevents: { zh: '阻止', en: 'Prevents' },
  inhibits: { zh: '抑制', en: 'Inhibits' },
}

/** 抽取器标签 */
const EXTRACTOR_LABELS: Record<AssertionExtractor, { zh: string; en: string }> = {
  llm: { zh: 'LLM', en: 'LLM' },
  rule: { zh: '规则', en: 'Rule' },
}

export function AssertionReviewView({ language }: AssertionReviewViewProps) {
  const isZh = language === 'zh'
  const [assertions, setAssertions] = useState<CausalAssertion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<AssertionReviewStatus | ''>('pending')
  const [keyword, setKeyword] = useState('')
  const [showReport, setShowReport] = useState(false)
  const [showExtract, setShowExtract] = useState(false)

  /** 加载断言列表 */
  const loadAssertions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.listAssertions({
        reviewStatus: filterStatus || undefined,
      })
      if (result.success && result.data) {
        let list = result.data as CausalAssertion[]
        if (keyword) {
          const kw = keyword.toLowerCase()
          list = list.filter(
            (a) =>
              a.sourceText.toLowerCase().includes(kw) ||
              a.causeName.toLowerCase().includes(kw) ||
              a.effectName.toLowerCase().includes(kw),
          )
        }
        setAssertions(list)
      } else {
        setError(result.error || (isZh ? '加载失败' : 'Load failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to load assertions:', e)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, keyword, isZh])

  useEffect(() => {
    void loadAssertions()
  }, [loadAssertions])

  /** 审核断言 */
  const handleReview = useCallback(
    async (
      assertionId: string,
      status: 'approved' | 'rejected' | 'merged',
      note?: string,
    ) => {
      try {
        const result = await window.electronAPI.causal.reviewAssertion(assertionId, {
          status,
          reviewedBy: 'user',
          reviewNote: note,
        })
        if (result.success) {
          await loadAssertions()
        } else {
          alert(result.error)
        }
      } catch (e) {
        logger.causal?.error('Failed to review assertion:', e)
        alert(e instanceof Error ? e.message : String(e))
      }
    },
    [loadAssertions],
  )

  /** 待审核数量统计 */
  const pendingCount = assertions.filter((a) => a.reviewStatus === 'pending').length

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-3 border-b border-border/40 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={isZh ? '搜索源文本/因/果…' : 'Search text/cause/effect…'}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as AssertionReviewStatus | '')}
          className="px-2 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="">{isZh ? '全部状态' : 'All status'}</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {isZh ? label.zh : label.en}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowExtract(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all"
          title={isZh ? '从文本抽取因果断言' : 'Extract assertions from text'}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isZh ? '抽取' : 'Extract'}
        </button>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          {isZh ? '上报' : 'Report'}
        </button>
      </div>

      {/* 状态信息 */}
      {filterStatus === 'pending' && pendingCount > 0 && (
        <div className="px-3 py-1.5 bg-amber-500/10 text-amber-600 text-[11px] flex items-center gap-1.5 border-b border-amber-500/20">
          <Clock className="w-3 h-3" />
          {isZh ? `有 ${pendingCount} 条待审核断言` : `${pendingCount} assertion(s) pending review`}
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-[12px]">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
            {isZh ? '加载中…' : 'Loading…'}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-red-500 text-[12px]">
            <AlertCircle className="w-4 h-4 mr-2" />
            {error}
          </div>
        ) : assertions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-text-muted text-[12px]">
            <Sparkles className="w-8 h-8 mb-2 opacity-40" />
            {isZh ? '暂无断言' : 'No assertions'}
          </div>
        ) : (
          assertions.map((assertion) => (
            <AssertionRow
              key={assertion.id}
              assertion={assertion}
              isZh={isZh}
              onReview={handleReview}
            />
          ))
        )}
      </div>

      {/* 上报弹层 */}
      {showReport && (
        <ReportAssertionDialog
          language={language}
          onClose={() => setShowReport(false)}
          onSaved={() => {
            setShowReport(false)
            void loadAssertions()
          }}
        />
      )}

      {/* 抽取弹层 */}
      {showExtract && (
        <ExtractAssertionDialog
          language={language}
          onClose={() => setShowExtract(false)}
          onSaved={() => {
            setShowExtract(false)
            void loadAssertions()
          }}
        />
      )}
    </div>
  )
}

/** 断言行 */
function AssertionRow({
  assertion,
  isZh,
  onReview,
}: {
  assertion: CausalAssertion
  isZh: boolean
  onReview: (
    assertionId: string,
    status: 'approved' | 'rejected' | 'merged',
    note?: string,
  ) => Promise<void>
}) {
  const status = STATUS_LABELS[assertion.reviewStatus]
  const relation = RELATION_LABELS[assertion.relation]
  const extractor = EXTRACTOR_LABELS[assertion.extractor]
  const isPending = assertion.reviewStatus === 'pending'
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')

  const handleAction = (action: 'approved' | 'rejected' | 'merged') => {
    if (action === 'rejected' && !note.trim()) {
      setShowNote(true)
      return
    }
    void onReview(assertion.id, action, note.trim() || undefined)
  }

  return (
    <div className="p-3 rounded-xl bg-surface/40 border border-border/40 hover:border-border transition-all">
      {/* 头部：因→关系→果 */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-medium text-text-primary">{assertion.causeName}</span>
        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-[12px] font-medium text-accent">
          {isZh ? relation.zh : relation.en}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-sm font-medium text-text-primary">{assertion.effectName}</span>
        <span className="ml-auto px-1.5 py-0.5 rounded text-[11px] bg-surface/60 text-text-muted">
          {isZh ? extractor.zh : extractor.en}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] ${status.bg} ${status.color}`}>
          {isZh ? status.zh : status.en}
        </span>
      </div>

      {/* 源文本 */}
      <p className="text-[12px] text-text-secondary italic line-clamp-2 mb-2">
        "{assertion.sourceText}"
      </p>

      {/* 元信息 */}
      <div className="flex items-center gap-3 text-[11px] text-text-muted mb-2">
        <span>
          {isZh ? '强度' : 'Strength'}: {assertion.strength.toFixed(2)}
        </span>
        <span>
          {isZh ? '时间' : 'Time'}: {new Date(assertion.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
        </span>
        {assertion.reviewNote && (
          <span className="text-text-secondary">
            {isZh ? '备注' : 'Note'}: {assertion.reviewNote}
          </span>
        )}
      </div>

      {/* 审核操作 */}
      {isPending && (
        <div className="pt-2 border-t border-border/30">
          {showNote ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={isZh ? '输入拒绝原因（可选）' : 'Reason for rejection (optional)'}
                className="w-full px-2 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50 resize-none"
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void handleAction('rejected')}
                  className="px-2 py-1 rounded text-[11px] bg-red-500/15 text-red-500 hover:bg-red-500/25"
                >
                  {isZh ? '确认拒绝' : 'Confirm Reject'}
                </button>
                <button
                  onClick={() => {
                    setShowNote(false)
                    setNote('')
                  }}
                  className="px-2 py-1 rounded text-[11px] text-text-muted hover:bg-surface-hover"
                >
                  {isZh ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => void handleAction('approved')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                title={isZh ? '通过：自动转化为边' : 'Approve: convert to edge'}
              >
                <CheckCircle2 className="w-3 h-3" />
                {isZh ? '通过' : 'Approve'}
              </button>
              <button
                onClick={() => void handleAction('rejected')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-red-500/15 text-red-500 hover:bg-red-500/25"
              >
                <XCircle className="w-3 h-3" />
                {isZh ? '拒绝' : 'Reject'}
              </button>
              <button
                onClick={() => void handleAction('merged')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-violet-500/15 text-violet-500 hover:bg-violet-500/25"
                title={isZh ? '合并到已有边' : 'Merge into existing edge'}
              >
                <GitMerge className="w-3 h-3" />
                {isZh ? '合并' : 'Merge'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 上报断言弹窗 */
function ReportAssertionDialog({
  language,
  onClose,
  onSaved,
}: {
  language: Language
  onClose: () => void
  onSaved: () => void
}) {
  const isZh = language === 'zh'
  const [sourceText, setSourceText] = useState('')
  const [causeName, setCauseName] = useState('')
  const [effectName, setEffectName] = useState('')
  const [relation, setRelation] = useState<CausalEdgeRelation>('causes')
  const [strength, setStrength] = useState(0.7)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!sourceText.trim() || !causeName.trim() || !effectName.trim()) {
      setError(isZh ? '源文本、因、果均必填' : 'Source text, cause, effect are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.reportAssertion({
        sourceText: sourceText.trim(),
        causeName: causeName.trim(),
        effectName: effectName.trim(),
        relation,
        strength,
        extractor: 'rule',
      })
      if (result.success) {
        onSaved()
      } else {
        setError(result.error || (isZh ? '上报失败' : 'Report failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to report assertion:', e)
    } finally {
      setSaving(false)
    }
  }, [sourceText, causeName, effectName, relation, strength, isZh, onSaved])

  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '上报断言' : 'Report Assertion'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '源文本' : 'Source Text'} *
            </label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 resize-none"
              placeholder={isZh ? '触发该断言的原始文本' : 'Original text that triggered the assertion'}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '因' : 'Cause'} *
              </label>
              <input
                type="text"
                value={causeName}
                onChange={(e) => setCauseName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '果' : 'Effect'} *
              </label>
              <input
                type="text"
                value={effectName}
                onChange={(e) => setEffectName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '关系' : 'Relation'}
              </label>
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value as CausalEdgeRelation)}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              >
                {Object.entries(RELATION_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {isZh ? label.zh : label.en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '强度' : 'Strength'}: {strength.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-500 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {isZh ? '上报' : 'Report'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 抽取断言弹窗 */
function ExtractAssertionDialog({
  language,
  onClose,
  onSaved,
}: {
  language: Language
  onClose: () => void
  onSaved: () => void
}) {
  const isZh = language === 'zh'
  const [text, setText] = useState('')
  const [minConfidence, setMinConfidence] = useState(0.6)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedAssertion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  /** 执行抽取 */
  const handleExtract = useCallback(async () => {
    if (!text.trim()) {
      setError(isZh ? '请输入文本' : 'Please enter text')
      return
    }
    setExtracting(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.extractAssertions(text, minConfidence)
      if (result.success && result.data) {
        const list = result.data as ExtractedAssertion[]
        setExtracted(list)
        if (list.length === 0) {
          setError(isZh ? '未抽取到任何断言' : 'No assertions extracted')
        }
      } else {
        setError(result.error || (isZh ? '抽取失败' : 'Extract failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to extract assertions:', e)
    } finally {
      setExtracting(false)
    }
  }, [text, minConfidence, isZh])

  /** 批量导入抽取结果 */
  const handleImport = useCallback(async () => {
    if (extracted.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.batchReportAssertions(
        extracted.map((e) => ({
          sourceText: e.sourceText,
          causeName: e.causeName,
          effectName: e.effectName,
          relation: e.relation,
          strength: e.strength,
          extractor: e.extractor,
          extractMeta: e.extractMeta,
        })),
      )
      if (result.success) {
        onSaved()
      } else {
        setError(result.error || (isZh ? '导入失败' : 'Import failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to import assertions:', e)
    } finally {
      setImporting(false)
    }
  }, [extracted, onSaved, isZh])

  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-2xl bg-surface rounded-2xl border border-border shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '从文本抽取断言' : 'Extract Assertions from Text'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '输入文本' : 'Input Text'}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 resize-none"
              placeholder={
                isZh
                  ? '粘贴包含因果关系的文本，如"咖啡因摄入导致注意力提升，但会抑制睡眠质量"'
                  : 'Paste text containing causal relations, e.g., "Caffeine intake causes attention increase, but inhibits sleep quality"'
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[12px] font-medium text-text-secondary">
              {isZh ? '最小置信度' : 'Min Confidence'}: {minConfidence.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
              className="flex-1 max-w-[200px]"
            />
            <button
              onClick={() => void handleExtract()}
              disabled={extracting}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-60"
            >
              {extracting ? (
                <div className="w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {isZh ? '抽取' : 'Extract'}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-500 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {extracted.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[12px] font-bold text-text-primary">
                  {isZh ? `抽取结果（${extracted.length} 条）` : `Results (${extracted.length})`}
                </h4>
                <button
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-accent text-white hover:bg-accent/90 disabled:opacity-60"
                >
                  {importing && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {isZh ? '全部导入' : 'Import All'}
                </button>
              </div>
              {extracted.map((item, idx) => {
                const rel = RELATION_LABELS[item.relation]
                return (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-surface/40 border border-border/40 text-[12px]"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-text-primary">{item.causeName}</span>
                      <ChevronRight className="w-3 h-3 text-text-muted" />
                      <span className="text-accent">{isZh ? rel.zh : rel.en}</span>
                      <ChevronRight className="w-3 h-3 text-text-muted" />
                      <span className="font-medium text-text-primary">{item.effectName}</span>
                      <span className="ml-auto text-text-muted">
                        {item.extractMeta?.confidence !== undefined
                          ? `${(item.extractMeta.confidence as number).toFixed(2)}`
                          : item.strength.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
