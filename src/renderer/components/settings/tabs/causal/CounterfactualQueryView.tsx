/**
 * 反事实查询视图
 *
 * 提供因果推理的核心交互能力：
 * - 干预查询（do-calculus）：do(X=x) → 观察 Y 的变化
 * - 反事实查询：在观察到 Y=y 时，若 do(X=x')，Y 会变成什么
 * - 查询历史记录（可按类型/时间筛选）
 *
 * 数据来源：window.electronAPI.causal.{intervention,counterfactual,listQueries}
 *
 * @module settings/tabs/causal/CounterfactualQueryView
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GitBranch,
  Play,
  AlertCircle,
  Clock,
  History,
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  CausalNode,
  InterventionResult,
  CounterfactualResult,
  CounterfactualQueryRecord,
  CounterfactualQueryType,
  ImpactLevel,
  ChangeDirection,
} from '@main/preload/api/causalReasoning'

interface CounterfactualQueryViewProps {
  language: Language
}

/** 影响等级标签 */
const IMPACT_LABELS: Record<ImpactLevel, { zh: string; en: string; color: string }> = {
  strong: { zh: '强', en: 'Strong', color: 'text-red-500' },
  moderate: { zh: '中', en: 'Moderate', color: 'text-amber-500' },
  weak: { zh: '弱', en: 'Weak', color: 'text-cyan-500' },
  negligible: { zh: '可忽略', en: 'Negligible', color: 'text-text-muted' },
}

/** 变化方向标签 */
const DIRECTION_LABELS: Record<ChangeDirection, { zh: string; en: string; icon: typeof TrendingUp; color: string }> = {
  increase: { zh: '上升', en: 'Increase', icon: TrendingUp, color: 'text-emerald-500' },
  decrease: { zh: '下降', en: 'Decrease', icon: TrendingDown, color: 'text-red-500' },
  flip: { zh: '反转', en: 'Flip', icon: Activity, color: 'text-amber-500' },
  none: { zh: '无变化', en: 'No change', icon: Activity, color: 'text-text-muted' },
}

/** 查询类型标签 */
const QUERY_TYPE_LABELS: Record<CounterfactualQueryType, { zh: string; en: string }> = {
  intervention: { zh: '干预', en: 'Intervention' },
  counterfactual: { zh: '反事实', en: 'Counterfactual' },
}

type QueryMode = 'intervention' | 'counterfactual'

export function CounterfactualQueryView({ language }: CounterfactualQueryViewProps) {
  const isZh = language === 'zh'
  const [mode, setMode] = useState<QueryMode>('intervention')
  const [nodes, setNodes] = useState<CausalNode[]>([])
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<InterventionResult | CounterfactualResult | null>(null)
  const [querying, setQuerying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 表单字段
  const [interventionVar, setInterventionVar] = useState('')
  const [interventionValue, setInterventionValue] = useState('')
  const [observedVar, setObservedVar] = useState('')
  const [observedValue, setObservedValue] = useState('')

  // 历史
  const [history, setHistory] = useState<CounterfactualQueryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [filterType, setFilterType] = useState<CounterfactualQueryType | ''>('')

  /** 加载节点列表 */
  const loadNodes = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.causal.listNodes({ enabled: true })
      if (result.success && result.data) {
        const list = result.data as CausalNode[]
        setNodes(list)
        if (list.length > 0) {
          setInterventionVar(list[0].id)
          setObservedVar(list.length > 1 ? list[1].id : list[0].id)
        }
      }
    } catch (e) {
      logger.causal?.error('Failed to load nodes for query:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载历史 */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const result = await window.electronAPI.causal.listQueries({
        queryType: filterType || undefined,
      })
      if (result.success && result.data) {
        setHistory(result.data as CounterfactualQueryRecord[])
      }
    } catch (e) {
      logger.causal?.error('Failed to load query history:', e)
    } finally {
      setHistoryLoading(false)
    }
  }, [filterType])

  useEffect(() => {
    void loadNodes()
  }, [loadNodes])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  /** 节点 id → name 映射 */
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>()
    nodes.forEach((n) => map.set(n.id, n.name))
    return map
  }, [nodes])

  /** 执行查询 */
  const handleQuery = useCallback(async () => {
    if (!interventionVar || !observedVar) {
      setError(isZh ? '请选择干预变量和观察变量' : 'Please select intervention and observed variables')
      return
    }
    if (interventionVar === observedVar) {
      setError(isZh ? '干预变量和观察变量不能相同' : 'Intervention and observed variables cannot be the same')
      return
    }
    setQuerying(true)
    setError(null)
    setResult(null)
    try {
      // 尝试解析 interventionValue 为数字/布尔/字符串
      const parsedValue = parseValue(interventionValue)
      const result =
        mode === 'intervention'
          ? await window.electronAPI.causal.intervention(interventionVar, parsedValue, observedVar)
          : await window.electronAPI.causal.counterfactual(
              interventionVar,
              parsedValue,
              observedVar,
              parseValue(observedValue),
            )
      if (result.success && result.data) {
        setResult(result.data as InterventionResult | CounterfactualResult)
      } else {
        setError(result.error || (isZh ? '查询失败' : 'Query failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to execute query:', e)
    } finally {
      setQuerying(false)
      // 刷新历史
      void loadHistory()
    }
  }, [interventionVar, observedVar, interventionValue, observedValue, mode, isZh, loadHistory])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-text-muted text-[12px]">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
        {isZh ? '加载节点中…' : 'Loading nodes…'}
      </div>
    )
  }

  if (nodes.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-text-muted text-[12px]">
        <GitBranch className="w-8 h-8 mb-2 opacity-40" />
        {isZh ? '至少需要 2 个节点才能执行查询' : 'Need at least 2 nodes to perform queries'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 模式切换 */}
      <div className="flex items-center gap-1 p-2 border-b border-border/40 bg-surface/30">
        <ModeButton
          active={mode === 'intervention'}
          onClick={() => {
            setMode('intervention')
            setResult(null)
            setError(null)
          }}
          label={isZh ? '干预查询 do(X)' : 'Intervention do(X)'}
        />
        <ModeButton
          active={mode === 'counterfactual'}
          onClick={() => {
            setMode('counterfactual')
            setResult(null)
            setError(null)
          }}
          label={isZh ? '反事实查询' : 'Counterfactual'}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 查询表单 */}
        <div className="p-4 rounded-xl bg-surface/40 border border-border/40 space-y-3">
          <div className="flex items-center gap-2 text-[12px] font-bold text-text-primary">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            {mode === 'intervention'
              ? isZh
                ? '执行 do(X=x)，观察 Y 的变化'
                : 'Perform do(X=x), observe change in Y'
              : isZh
                ? '在观察到 Y=y 时，若 do(X=x\')，Y 会变成什么'
                : 'Given Y=y, what would Y be if do(X=x\')?'}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 干预变量 */}
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '干预变量 X' : 'Intervention X'}
              </label>
              <select
                value={interventionVar}
                onChange={(e) => setInterventionVar(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            {/* 干预值 */}
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '干预值 x' : 'Value x'}
              </label>
              <input
                type="text"
                value={interventionValue}
                onChange={(e) => setInterventionValue(e.target.value)}
                placeholder={isZh ? '如：true / 1.5 / hello' : 'e.g., true / 1.5 / hello'}
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 观察变量 */}
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {isZh ? '观察变量 Y' : 'Observed Y'}
              </label>
              <select
                value={observedVar}
                onChange={(e) => setObservedVar(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            {/* 观察值（仅反事实模式） */}
            {mode === 'counterfactual' && (
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                  {isZh ? '观察值 y' : 'Observed value y'}
                </label>
                <input
                  type="text"
                  value={observedValue}
                  onChange={(e) => setObservedValue(e.target.value)}
                  placeholder={isZh ? '如：false / 2.0 / world' : 'e.g., false / 2.0 / world'}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-500 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={() => void handleQuery()}
            disabled={querying}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-60 transition-all"
          >
            {querying ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isZh ? '执行查询' : 'Run Query'}
          </button>
        </div>

        {/* 查询结果 */}
        {result && <ResultPanel result={result} mode={mode} language={language} nodeNameMap={nodeNameMap} />}

        {/* 历史记录 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-text-secondary" />
            <h4 className="text-[12px] font-bold text-text-primary">
              {isZh ? '查询历史' : 'Query History'}
            </h4>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as CounterfactualQueryType | '')}
              className="ml-auto px-2 py-0.5 rounded text-[11px] bg-surface/40 border border-border/40 text-text-primary focus:outline-none"
            >
              <option value="">{isZh ? '全部' : 'All'}</option>
              {Object.entries(QUERY_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {isZh ? label.zh : label.en}
                </option>
              ))}
            </select>
            <button
              onClick={() => void loadHistory()}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover"
              title={isZh ? '刷新' : 'Refresh'}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-6 text-text-muted text-[12px]">
              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
              {isZh ? '加载中…' : 'Loading…'}
            </div>
          ) : history.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-text-muted text-[12px]">
              <Clock className="w-3.5 h-3.5 mr-2 opacity-40" />
              {isZh ? '暂无查询历史' : 'No query history'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {history.slice(0, 20).map((item) => (
                <HistoryRow
                  key={item.id}
                  record={item}
                  isZh={isZh}
                  nodeNameMap={nodeNameMap}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 模式按钮 */
function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
        active
          ? 'bg-accent text-white shadow-sm'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  )
}

/** 结果面板 */
function ResultPanel({
  result,
  mode,
  language,
  nodeNameMap,
}: {
  result: InterventionResult | CounterfactualResult
  mode: QueryMode
  language: Language
  nodeNameMap: Map<string, string>
}) {
  const isZh = language === 'zh'
  const impact = IMPACT_LABELS[result.impactLevel]
  const isCounterfactual = mode === 'counterfactual' && 'counterfactualValue' in result
  const direction = isCounterfactual
    ? DIRECTION_LABELS[(result as CounterfactualResult).changeDirection]
    : null
  const DirectionIcon = direction?.icon

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-accent/30 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent" />
        <h4 className="text-sm font-bold text-text-primary">
          {isZh ? '查询结果' : 'Query Result'}
        </h4>
        <span className={`ml-auto px-2 py-0.5 rounded text-[11px] font-medium bg-surface/60 ${impact.color}`}>
          {isZh ? `${impact.zh}影响` : `${impact.en} impact`}
        </span>
      </div>

      {/* 影响分数 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-2 rounded-lg bg-surface/40 border border-border/40">
          <div className="text-[11px] text-text-muted">
            {isZh ? '影响分数' : 'Impact Score'}
          </div>
          <div className="text-sm font-bold text-text-primary tabular-nums">
            {result.impactScore.toFixed(3)}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-surface/40 border border-border/40">
          <div className="text-[11px] text-text-muted">
            {isZh ? '总强度' : 'Total Strength'}
          </div>
          <div className="text-sm font-bold text-text-primary tabular-nums">
            {result.totalStrength.toFixed(3)}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-surface/40 border border-border/40">
          <div className="text-[11px] text-text-muted">
            {isZh ? '耗时' : 'Duration'}
          </div>
          <div className="text-sm font-bold text-text-primary tabular-nums">
            {result.durationMs}ms
          </div>
        </div>
      </div>

      {/* 反事实特有字段 */}
      {isCounterfactual && (
        <div className="p-3 rounded-lg bg-surface/40 border border-border/40 space-y-2">
          <div className="text-[12px] font-bold text-text-primary">
            {isZh ? '反事实推理' : 'Counterfactual Reasoning'}
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <span className="text-text-muted">{isZh ? '观察值: ' : 'Observed: '}</span>
              <span className="text-text-primary font-medium">
                {formatValue((result as CounterfactualResult).observedValue)}
              </span>
            </div>
            <div>
              <span className="text-text-muted">{isZh ? '反事实值: ' : 'Counterfactual: '}</span>
              <span className="text-accent font-medium">
                {formatValue((result as CounterfactualResult).counterfactualValue)}
              </span>
            </div>
            <div>
              <span className="text-text-muted">{isZh ? '置信度: ' : 'Confidence: '}</span>
              <span className="text-text-primary font-medium">
                {((result as CounterfactualResult).confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-text-muted">{isZh ? '变化: ' : 'Change: '}</span>
              {DirectionIcon && (
                <>
                  <DirectionIcon className={`w-3 h-3 ${direction!.color}`} />
                  <span className={`font-medium ${direction!.color}`}>
                    {isZh ? direction!.zh : direction!.en}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 因果路径 */}
      {result.causalPaths.length > 0 && (
        <div className="p-3 rounded-lg bg-surface/40 border border-border/40">
          <div className="text-[12px] font-bold text-text-primary mb-2">
            {isZh ? `因果路径（${result.causalPaths.length} 条）` : `Causal Paths (${result.causalPaths.length})`}
          </div>
          <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
            {result.causalPaths.slice(0, 20).map((path, idx) => (
              <div key={idx} className="flex items-center gap-1 text-[11px] text-text-secondary flex-wrap">
                <span className="text-text-muted tabular-nums">{idx + 1}.</span>
                {path.map((nodeId, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-text-muted" />}
                    <span className="text-text-primary">{nodeNameMap.get(nodeId) || nodeId}</span>
                  </span>
                ))}
              </div>
            ))}
            {result.causalPaths.length > 20 && (
              <div className="text-[11px] text-text-muted italic">
                {isZh ? `…还有 ${result.causalPaths.length - 20} 条路径` : `…${result.causalPaths.length - 20} more paths`}
              </div>
            )}
          </div>
        </div>
      )}

      {result.truncatedEdges > 0 && (
        <div className="text-[11px] text-text-muted italic">
          {isZh ? `（已截断 ${result.truncatedEdges} 条边）` : `(${result.truncatedEdges} edges truncated)`}
        </div>
      )}
    </div>
  )
}

/** 历史记录行 */
function HistoryRow({
  record,
  isZh,
  nodeNameMap,
}: {
  record: CounterfactualQueryRecord
  isZh: boolean
  nodeNameMap: Map<string, string>
}) {
  const typeLabel = QUERY_TYPE_LABELS[record.queryType]
  const success = record.success
  return (
    <div className="p-2 rounded-lg bg-surface/40 border border-border/40 text-[12px]">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] ${
            record.queryType === 'intervention'
              ? 'bg-cyan-500/10 text-cyan-500'
              : 'bg-violet-500/10 text-violet-500'
          }`}
        >
          {isZh ? typeLabel.zh : typeLabel.en}
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${success ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className="text-text-muted ml-auto">
          {new Date(record.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
        </span>
      </div>
      <div className="text-text-secondary flex items-center gap-1 flex-wrap">
        <span className="text-text-muted">do(</span>
        <span className="text-text-primary">{nodeNameMap.get(record.interventionVar) || record.interventionVar}</span>
        <span className="text-text-muted">=</span>
        <span className="text-accent">{formatValue(record.interventionValue)}</span>
        <span className="text-text-muted">)</span>
        <ChevronRight className="w-2.5 h-2.5 text-text-muted" />
        <span className="text-text-primary">{nodeNameMap.get(record.observedVar) || record.observedVar}</span>
      </div>
      {!success && record.error && (
        <div className="text-red-500 text-[11px] mt-1">{record.error}</div>
      )}
    </div>
  )
}

/** 解析输入值为数字/布尔/字符串 */
function parseValue(input: string): unknown {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const num = Number(trimmed)
  if (!isNaN(num) && trimmed !== '') return num
  // 尝试 JSON 解析
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

/** 格式化值显示 */
function formatValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
