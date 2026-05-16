import { useState, useCallback, useEffect, useRef } from 'react'
import {
  BarChart3,
  TrendingUp,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Cpu,
} from 'lucide-react'
import * as echarts from 'echarts/core'
import { BarChart as EBarChart, LineChart as ELineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'

echarts.use([EBarChart, ELineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

interface UsageRecord {
  id: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestId: string | null
  createdAt: string
}

interface UsagePanelProps {
  language: Language
}

const providerLabels: Record<string, { zh: string; en: string }> = {
  OPENAI: { zh: 'OpenAI', en: 'OpenAI' },
  ANTHROPIC: { zh: 'Anthropic', en: 'Anthropic' },
  GOOGLE: { zh: 'Google', en: 'Google' },
  DEEPSEEK: { zh: 'DeepSeek', en: 'DeepSeek' },
  ZHIPU: { zh: '智谱', en: 'Zhipu' },
  QWEN: { zh: '通义千问', en: 'Qwen' },
  BAIDU: { zh: '百度', en: 'Baidu' },
}

function getProviderLabel(provider: string, language: Language): string {
  const labels = providerLabels[provider.toUpperCase()]
  if (labels) return language === 'zh' ? labels.zh : labels.en
  return provider
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function UsagePanel({ language }: UsagePanelProps) {
  const [usageStats, setUsageStats] = useState<{
    summary: { totalTokens: number; promptTokens: number; completionTokens: number; totalRequests: number }
    byModel: Array<{ model: string; totalTokens: number; promptTokens: number; completionTokens: number; totalRequests: number }>
    byDate: Array<{ date: string; totalTokens: number; promptTokens: number; completionTokens: number; totalRequests: number }>
  } | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [statsPeriod, setStatsPeriod] = useState<7 | 30>(7)
  const dailyChartRef = useRef<HTMLDivElement>(null)
  const dailyChartInstance = useRef<echarts.ECharts | null>(null)

  const [records, setRecords] = useState<UsageRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsTotalPages, setRecordsTotalPages] = useState(0)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const recordsLimit = 10

  const getLocalDateStr = useCallback((date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const fetchRecords = useCallback(async () => {
    setLoadingRecords(true)
    try {
      const now = new Date()
      const endDate = getLocalDateStr(now)
      const startDate = getLocalDateStr(new Date(now.getTime() - statsPeriod * 86400000))
      const result = await backendApi.get<{
        records: UsageRecord[]
        total: number
        page: number
        totalPages: number
      }>(`/api/v1/usage/detail?page=${recordsPage}&limit=${recordsLimit}&startDate=${startDate}&endDate=${endDate}`)
      setRecords(result?.records || [])
      setRecordsTotal(result?.total || 0)
      setRecordsTotalPages(result?.totalPages || 0)
    } catch {
      setRecords([])
      setRecordsTotal(0)
      setRecordsTotalPages(0)
    } finally {
      setLoadingRecords(false)
    }
  }, [recordsPage, statsPeriod, getLocalDateStr])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  useEffect(() => {
    setLoadingStats(true)
    const now = new Date()
    const endDate = getLocalDateStr(now)
    const startDate = getLocalDateStr(new Date(now.getTime() - statsPeriod * 86400000))
    backendApi
      .get(`/api/v1/usage/stats?startDate=${startDate}&endDate=${endDate}`)
      .then(data => setUsageStats(data as typeof usageStats))
      .catch(() => setUsageStats(null))
      .finally(() => setLoadingStats(false))
  }, [statsPeriod, getLocalDateStr])

  useEffect(() => {
    if (!usageStats || !dailyChartRef.current) return
    if (dailyChartInstance.current) dailyChartInstance.current.dispose()
    const chart = echarts.init(dailyChartRef.current, 'dark')
    dailyChartInstance.current = chart
    const dates = usageStats.byDate.map(d => {
      const dateStr = typeof d.date === 'string' ? d.date.slice(0, 10) : String(d.date).slice(0, 10)
      return dateStr.slice(5)
    })
    const totalTokens = usageStats.byDate.map(d => d.totalTokens)
    const promptTokens = usageStats.byDate.map(d => d.promptTokens)
    const completionTokens = usageStats.byDate.map(d => d.completionTokens)
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 50, right: 16, top: 36, bottom: 32 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(30,30,30,0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { fontSize: 13, color: '#eee' },
        formatter: (params: any) => {
          let html = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`
          params.forEach((p: any) => {
            html += `<div style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}: <b>${p.value.toLocaleString()}</b></div>`
          })
          return html
        },
      },
      legend: {
        data: [
          language === 'zh' ? '总Token' : 'Total',
          language === 'zh' ? '输入Token' : 'Prompt',
          language === 'zh' ? '输出Token' : 'Completion',
        ],
        textStyle: { fontSize: 12, color: '#999' },
        top: 4, right: 4, itemWidth: 12, itemHeight: 8,
      },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, color: '#888' }, axisLine: { lineStyle: { color: '#333' } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#888', formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v) }, splitLine: { lineStyle: { color: '#222' } } },
      series: [
        { name: language === 'zh' ? '总Token' : 'Total', type: 'bar', data: totalTokens, itemStyle: { color: '#6366f1', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 16 },
        { name: language === 'zh' ? '输入Token' : 'Prompt', type: 'line', data: promptTokens, smooth: true, lineStyle: { width: 1.5, color: '#22d3ee' }, itemStyle: { color: '#22d3ee' }, symbol: 'none' },
        { name: language === 'zh' ? '输出Token' : 'Completion', type: 'line', data: completionTokens, smooth: true, lineStyle: { width: 1.5, color: '#f472b6' }, itemStyle: { color: '#f472b6' }, symbol: 'none' },
      ],
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); dailyChartInstance.current = null }
  }, [usageStats, language])

  const handlePeriodChange = useCallback((period: 7 | 30) => {
    setStatsPeriod(period)
    setRecordsPage(1)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-accent" />
          {language === 'zh' ? '使用统计' : 'Usage Statistics'}
        </h4>
        <div className="flex gap-1">
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => handlePeriodChange(d as 7 | 30)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                statsPeriod === d
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:bg-surface-hover'
              }`}
            >
              {language === 'zh' ? `近${d}天` : `${d}D`}
            </button>
          ))}
        </div>
      </div>

      {loadingStats ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
        </div>
      ) : !usageStats ? (
        <div className="text-center py-6 text-sm text-text-muted">
          {language === 'zh' ? '暂无使用数据' : 'No usage data'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30">
              <p className="text-sm text-text-muted mb-1">{language === 'zh' ? '总Token' : 'Total Tokens'}</p>
              <p className="text-lg font-bold text-text-primary font-mono">{formatTokenCount(usageStats.summary.totalTokens)}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30">
              <p className="text-sm text-text-muted mb-1">{language === 'zh' ? '请求次数' : 'Requests'}</p>
              <p className="text-lg font-bold text-text-primary font-mono">{usageStats.summary.totalRequests.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30">
              <p className="text-sm text-text-muted mb-1">{language === 'zh' ? '输入Token' : 'Prompt'}</p>
              <p className="text-base font-bold text-cyan-400 font-mono">{formatTokenCount(usageStats.summary.promptTokens)}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30">
              <p className="text-sm text-text-muted mb-1">{language === 'zh' ? '输出Token' : 'Completion'}</p>
              <p className="text-base font-bold text-pink-400 font-mono">{formatTokenCount(usageStats.summary.completionTokens)}</p>
            </div>
          </div>

          {usageStats.byDate.length > 0 && (
            <div className="rounded-lg bg-surface/30 border border-border/30 p-3">
              <p className="text-[11px] text-text-muted mb-2 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {language === 'zh' ? '每日使用趋势' : 'Daily Usage Trend'}
              </p>
              <div ref={dailyChartRef} className="w-full h-48" />
            </div>
          )}
        </>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-accent/70" />
            {language === 'zh' ? '使用明细' : 'Usage Details'}
          </h5>
          {recordsTotal > 0 && (
            <span className="text-xs text-text-muted">
              {language === 'zh' ? `共 ${recordsTotal} 条` : `${recordsTotal} records`}
            </span>
          )}
        </div>

        {loadingRecords ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-8 text-sm text-text-muted">
            {language === 'zh' ? '暂无使用明细' : 'No usage details'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '时间' : 'Time'}
                    </th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '服务商' : 'Provider'}
                    </th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '模型' : 'Model'}
                    </th>
                    <th className="text-right py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '输入Token' : 'Prompt'}
                    </th>
                    <th className="text-right py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '输出Token' : 'Completion'}
                    </th>
                    <th className="text-right py-2.5 px-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {language === 'zh' ? '总Token' : 'Total'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(record => (
                    <tr key={record.id} className="border-b border-border/20 hover:bg-surface/30 transition-colors">
                      <td className="py-2.5 px-3 text-text-secondary whitespace-nowrap text-xs">
                        {new Date(record.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-3 text-text-secondary whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-surface/50 border border-border/30">
                          {getProviderLabel(record.provider, language)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-text-primary whitespace-nowrap font-mono text-xs">
                        {record.model}
                      </td>
                      <td className="py-2.5 px-3 text-right text-cyan-400 font-mono text-xs">
                        {formatTokenCount(record.promptTokens)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-pink-400 font-mono text-xs">
                        {formatTokenCount(record.completionTokens)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-text-primary font-mono text-xs font-medium">
                        {formatTokenCount(record.totalTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {recordsTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-text-muted">
                  {language === 'zh'
                    ? `第 ${recordsPage} / ${recordsTotalPages} 页`
                    : `Page ${recordsPage} / ${recordsTotalPages}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setRecordsPage(p => Math.max(1, p - 1))}
                    disabled={recordsPage <= 1}
                    className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setRecordsPage(p => Math.min(recordsTotalPages, p + 1))}
                    disabled={recordsPage >= recordsTotalPages}
                    className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
