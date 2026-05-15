import { useState, useCallback, useEffect } from 'react'
import { TrendingUp, RefreshCw, ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface BenchmarkRecord {
  category: string
  metric: string
  industry_avg: number
  top_quartile: number
  unit: string
}

const CATEGORY_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  retail: { zh: '零售', en: 'Retail', color: 'text-blue-400' },
  restaurant: { zh: '餐饮', en: 'Restaurant', color: 'text-orange-400' },
  service: { zh: '服务', en: 'Service', color: 'text-green-400' },
}

const METRIC_LABELS: Record<string, { zh: string; en: string }> = {
  rent_ratio: { zh: '租金占比', en: 'Rent Ratio' },
  labor_ratio: { zh: '人工占比', en: 'Labor Ratio' },
  gross_margin: { zh: '毛利率', en: 'Gross Margin' },
  net_margin: { zh: '净利率', en: 'Net Margin' },
  inventory_turnover: { zh: '库存周转率', en: 'Inventory Turnover' },
  conversion_rate: { zh: '转化率', en: 'Conversion Rate' },
  repeat_rate: { zh: '复购率', en: 'Repeat Rate' },
  avg_transaction: { zh: '客单价', en: 'Avg Transaction' },
  seat_turnover: { zh: '翻台率', en: 'Seat Turnover' },
  food_cost_ratio: { zh: '食材成本率', en: 'Food Cost Ratio' },
  labor_efficiency: { zh: '人效', en: 'Labor Efficiency' },
  customer_satisfaction: { zh: '客户满意度', en: 'Customer Satisfaction' },
  appointment_rate: { zh: '预约率', en: 'Appointment Rate' },
  service_completion: { zh: '服务完成率', en: 'Service Completion' },
}

function ComparisonBar({ value, avg, top, unit }: { value: number; avg: number; top: number; unit: string }) {
  const maxVal = Math.max(value, avg, top, 1)
  const valuePct = (value / maxVal) * 100
  const avgPct = (avg / maxVal) * 100
  const topPct = (top / maxVal) * 100

  const diff = avg > 0 ? ((value - avg) / avg) * 100 : 0
  const isAbove = diff > 5
  const isBelow = diff < -5

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-accent/60 rounded-full" style={{ width: `${valuePct}%` }} />
          <div className="absolute inset-y-0 left-0 bg-text-muted/30 rounded-full" style={{ width: `${avgPct}%` }} />
          <div className="absolute inset-y-0 left-0 border border-green-400/40 rounded-full" style={{ width: `${topPct}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{value}{unit}</span>
        {isAbove && (
          <span className="text-green-400 flex items-center gap-0.5">
            <ArrowUpRight className="w-3 h-3" />+{diff.toFixed(1)}%
          </span>
        )}
        {isBelow && (
          <span className="text-red-400 flex items-center gap-0.5">
            <ArrowDownRight className="w-3 h-3" />{diff.toFixed(1)}%
          </span>
        )}
        {!isAbove && !isBelow && (
          <span className="text-text-muted flex items-center gap-0.5">
            <Minus className="w-3 h-3" />≈
          </span>
        )}
      </div>
    </div>
  )
}

export function IndustryBenchmarkPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [benchmarks, setBenchmarks] = useState<BenchmarkRecord[]>([])
  const [expandedCategory, setExpandedCategory] = useState<string | null>('retail')
  const [loading, setLoading] = useState(false)
  const [compareStoreId, setCompareStoreId] = useState<string | null>(null)
  const [storeMetrics, setStoreMetrics] = useState<Record<string, number>>({})
  const [storeList, setStoreList] = useState<Array<{ id: string; name: string }>>([])

  const sendToChat = useCallback(async (prompt: string) => {
    try {
      const agentConfig = getAgentConfig()
      await Agent.send(
        prompt,
        { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
        workspacePath,
        'agent',
      )
    } catch {}
  }, [llmConfig, workspacePath])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const result = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT * FROM industry_benchmarks ORDER BY category, metric')
      if (result.success && result.rows) {
        setBenchmarks(result.rows as unknown as BenchmarkRecord[])
      }

      const storeResult = await scenarioDatabaseManager.executeSql('store-diagnosis', 'SELECT id, name, type FROM stores')
      if (storeResult.success && storeResult.rows) {
        setStoreList(storeResult.rows as unknown as Array<{ id: string; name: string }>)
      }
    } catch {
      setBenchmarks([])
    }
    setLoading(false)
  }, [])

  const loadStoreComparison = useCallback(async (storeId: string) => {
    if (!storeId) { setCompareStoreId(null); setStoreMetrics({}); return }
    setCompareStoreId(storeId)
    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const finResult = await scenarioDatabaseManager.executeSql('store-diagnosis', `SELECT * FROM store_financials WHERE store_id = '${storeId}' ORDER BY period DESC LIMIT 1`)
      if (finResult.success && finResult.rows && finResult.rows.length > 0) {
        const fin = finResult.rows[0] as Record<string, unknown>
        const metrics: Record<string, number> = {}
        if (typeof fin.rent_cost === 'number' && typeof fin.revenue === 'number' && fin.revenue > 0) {
          metrics.rent_ratio = (fin.rent_cost as number / fin.revenue as number) * 100
        }
        if (typeof fin.labor_cost === 'number' && typeof fin.revenue === 'number' && fin.revenue > 0) {
          metrics.labor_ratio = (fin.labor_cost as number / fin.revenue as number) * 100
        }
        if (typeof fin.gross_profit === 'number' && typeof fin.revenue === 'number' && fin.revenue > 0) {
          metrics.gross_margin = (fin.gross_profit as number / fin.revenue as number) * 100
        }
        if (typeof fin.net_profit === 'number' && typeof fin.revenue === 'number' && fin.revenue > 0) {
          metrics.net_margin = (fin.net_profit as number / fin.revenue as number) * 100
        }
        setStoreMetrics(metrics)
      } else {
        setStoreMetrics({})
      }
    } catch {
      setStoreMetrics({})
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleQueryBenchmark = useCallback((category: string, metric: string) => {
    const catLabel = CATEGORY_LABELS[category]?.[language === 'zh' ? 'zh' : 'en'] || category
    const metLabel = METRIC_LABELS[metric]?.[language === 'zh' ? 'zh' : 'en'] || metric
    const prompt = language === 'zh'
      ? `请查询${catLabel}行业的${metLabel}基准数据，并给出详细分析`
      : `Please query the ${catLabel} industry benchmark for ${metLabel} and provide detailed analysis`
    sendToChat(prompt)
  }, [language, sendToChat])

  const groupedBenchmarks = benchmarks.reduce<Record<string, BenchmarkRecord[]>>((acc, b) => {
    if (!acc[b.category]) acc[b.category] = []
    acc[b.category].push(b)
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '行业基准' : 'BENCHMARKS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadData} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
        </div>
      </div>

      {storeList.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border/20">
          <select
            value={compareStoreId || ''}
            onChange={e => loadStoreComparison(e.target.value)}
            className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary"
          >
            <option value="">{language === 'zh' ? '选择门店对比...' : 'DropdownSelector store to compare...'}</option>
            {storeList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {Object.entries(groupedBenchmarks).map(([category, items]) => {
          const catInfo = CATEGORY_LABELS[category]
          const isExpanded = expandedCategory === category
          return (
            <div key={category}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
                onClick={() => setExpandedCategory(isExpanded ? null : category)}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
                <TrendingUp className={`w-3.5 h-3.5 flex-shrink-0 ${catInfo?.color || 'text-text-muted'}`} />
                <span className="text-xs text-text-primary flex-1">{catInfo?.[language === 'zh' ? 'zh' : 'en'] || category}</span>
                <span className="text-xs text-text-muted">{items.length}</span>
              </button>

              {isExpanded && (
                <div className="pl-8 pr-3 pb-2 space-y-2">
                  {items.map(bench => {
                    const metricLabel = METRIC_LABELS[bench.metric]?.[language === 'zh' ? 'zh' : 'en'] || bench.metric
                    const storeValue = storeMetrics[bench.metric]
                    return (
                      <div
                        key={bench.metric}
                        className="p-2 bg-surface/50 rounded cursor-pointer hover:bg-surface transition-colors"
                        onClick={() => handleQueryBenchmark(category, bench.metric)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-text-primary">{metricLabel}</span>
                          {compareStoreId && storeValue !== undefined && (
                            <span className="text-xs text-accent">{storeValue.toFixed(1)}{bench.unit}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-text-muted">
                            {language === 'zh' ? '均值' : 'Avg'}: <span className="text-text-secondary">{bench.industry_avg}{bench.unit}</span>
                          </span>
                          <span className="text-text-muted">
                            {language === 'zh' ? '优秀' : 'Top'}: <span className="text-green-400">{bench.top_quartile}{bench.unit}</span>
                          </span>
                        </div>
                        {compareStoreId && storeValue !== undefined && (
                          <ComparisonBar value={storeValue} avg={bench.industry_avg} top={bench.top_quartile} unit={bench.unit} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {benchmarks.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-text-muted">
            <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">{language === 'zh' ? '暂无基准数据' : 'No benchmark data'}</p>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border/30">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent/60" />{language === 'zh' ? '门店' : 'Store'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-text-muted/30" />{language === 'zh' ? '行业均值' : 'Industry Avg'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded border border-green-400/40" />{language === 'zh' ? '优秀线' : 'Top 25%'}</span>
        </div>
      </div>
    </div>
  )
}
