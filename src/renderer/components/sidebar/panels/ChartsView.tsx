import { useState, useCallback } from 'react'
import { BarChart3, LineChart, PieChart, ScatterChart, AreaChart, Plus, Grid3x3, List, X, Check } from 'lucide-react'
import { useStore } from '@store'
import { Button } from '../../ui'
import { Agent } from '@/renderer/agent/core'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'

interface ChartItem {
    id: string
    name: string
    type: 'bar' | 'line' | 'pie' | 'scatter' | 'area'
    source?: string
    createdAt: string
}

const CHART_TYPE_ICON: Record<ChartItem['type'], typeof BarChart3> = {
    bar: BarChart3,
    line: LineChart,
    pie: PieChart,
    scatter: ScatterChart,
    area: AreaChart,
}

const CHART_TYPES = [
    { value: 'bar' as const, label: 'Bar', labelZh: '柱状图' },
    { value: 'line' as const, label: 'Line', labelZh: '折线图' },
    { value: 'pie' as const, label: 'Pie', labelZh: '饼图' },
    { value: 'scatter' as const, label: 'Scatter', labelZh: '散点图' },
    { value: 'area' as const, label: 'Area', labelZh: '面积图' },
]

const DEMO_CHARTS: ChartItem[] = [
    { id: '1', name: 'Sales Overview', type: 'bar', source: 'workspace', createdAt: '2026-04-28' },
    { id: '2', name: 'Revenue Trend', type: 'line', source: 'workspace', createdAt: '2026-04-27' },
    { id: '3', name: 'Market Share', type: 'pie', source: 'SQLite Local', createdAt: '2026-04-25' },
]

export function ChartsView() {
    const language = useStore(s => s.language)
    const llmConfig = useStore(s => s.llmConfig)
    const workspacePath = useStore(s => s.workspacePath)

    const [charts, setCharts] = useState<ChartItem[]>(DEMO_CHARTS)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
    const [showNewForm, setShowNewForm] = useState(false)
    const [newChart, setNewChart] = useState({ name: '', type: 'bar' as ChartItem['type'] })

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

    const typeLabel = (type: ChartItem['type']) => {
        const labels: Record<ChartItem['type'], string> = {
            bar: language === 'zh' ? '柱状图' : 'Bar',
            line: language === 'zh' ? '折线图' : 'Line',
            pie: language === 'zh' ? '饼图' : 'Pie',
            scatter: language === 'zh' ? '散点图' : 'Scatter',
            area: language === 'zh' ? '面积图' : 'Area',
        }
        return labels[type]
    }

    const handleChartClick = useCallback((chart: ChartItem) => {
        const prompt = language === 'zh'
            ? `请帮我查看并更新图表「${chart.name}」（${typeLabel(chart.type)}），数据来源：${chart.source || '未知'}。`
            : `Please help me view and update the chart "${chart.name}" (${typeLabel(chart.type)}), data source: ${chart.source || 'unknown'}.`
        sendToChat(prompt)
    }, [language, sendToChat, typeLabel])

    const handleCreateChart = useCallback(() => {
        if (!newChart.name.trim()) return

        const chart: ChartItem = {
            id: Date.now().toString(),
            name: newChart.name.trim(),
            type: newChart.type,
            source: 'workspace',
            createdAt: new Date().toISOString().split('T')[0],
        }

        setCharts(prev => [...prev, chart])
        setShowNewForm(false)
        setNewChart({ name: '', type: 'bar' })

        const prompt = language === 'zh'
            ? `请帮我创建一个${typeLabel(chart.type)}图表「${chart.name}」，使用工作区中的数据。`
            : `Please help me create a ${typeLabel(chart.type)} chart "${chart.name}" using data from the workspace.`
        sendToChat(prompt)
    }, [newChart, language, sendToChat, typeLabel])

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    {language === 'zh' ? '图表' : 'CHARTS'}
                </span>
                <div className="flex items-center gap-1">
                    <Button
                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setViewMode('list')}
                    >
                        <List className="w-3 h-3" />
                    </Button>
                    <Button
                        variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setViewMode('grid')}
                    >
                        <Grid3x3 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowNewForm(true)} title={language === 'zh' ? '新建图表' : 'New Chart'}>
                        <Plus className="w-3 h-3" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {charts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-8">
                        <BarChart3 className="w-10 h-10 text-text-muted/75" />
                        <p className="text-xs text-text-muted text-center">
                            {language === 'zh' ? '暂无图表，点击 + 创建' : 'No charts yet. Click + to create one.'}
                        </p>
                    </div>
                ) : viewMode === 'list' ? (
                    charts.map((chart) => {
                        const Icon = CHART_TYPE_ICON[chart.type]
                        return (
                            <button
                                key={chart.id}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                                onClick={() => handleChartClick(chart)}
                            >
                                <Icon className="w-4 h-4 text-accent/70 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-text-primary truncate">{chart.name}</div>
                                    <div className="text-[11px] text-text-muted flex items-center gap-2">
                                        <span>{typeLabel(chart.type)}</span>
                                        {chart.source && (
                                            <>
                                                <span>·</span>
                                                <span>{chart.source}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </button>
                        )
                    })
                ) : (
                    <div className="p-2">
                        <div className="grid grid-cols-2 gap-2">
                            {charts.map((chart) => {
                                const Icon = CHART_TYPE_ICON[chart.type]
                                return (
                                    <button
                                        key={chart.id}
                                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-border/30 hover:bg-surface-hover transition-colors aspect-square"
                                        onClick={() => handleChartClick(chart)}
                                    >
                                        <Icon className="w-6 h-6 text-accent/60" />
                                        <span className="text-[12px] text-text-primary truncate w-full text-center">{chart.name}</span>
                                        <span className="text-[10px] text-text-muted">{typeLabel(chart.type)}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>

            {showNewForm && (
                <div className="border-t border-border/30 p-3 space-y-2 bg-surface/30">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-primary">
                            {language === 'zh' ? '新建图表' : 'New Chart'}
                        </span>
                        <button onClick={() => setShowNewForm(false)} className="text-text-muted hover:text-text-primary">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <input
                        type="text"
                        value={newChart.name}
                        onChange={e => setNewChart(f => ({ ...f, name: e.target.value }))}
                        placeholder={language === 'zh' ? '图表名称' : 'Chart name'}
                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                    />

                    <div className="flex gap-1">
                        {CHART_TYPES.map(ct => {
                            const Icon = CHART_TYPE_ICON[ct.value]
                            return (
                                <button
                                    key={ct.value}
                                    onClick={() => setNewChart(f => ({ ...f, type: ct.value }))}
                                    className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded transition-colors ${newChart.type === ct.value ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    <span className="text-[10px]">{language === 'zh' ? ct.labelZh : ct.label}</span>
                                </button>
                            )
                        })}
                    </div>

                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-full text-xs gap-1"
                        onClick={handleCreateChart}
                        disabled={!newChart.name.trim()}
                    >
                        <Check className="w-3 h-3" />
                        {language === 'zh' ? '创建' : 'Create'}
                    </Button>
                </div>
            )}

            {!showNewForm && (
                <div className="px-3 py-2 border-t border-border/30">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full text-xs gap-1.5"
                        onClick={() => setShowNewForm(true)}
                    >
                        <Plus className="w-3 h-3" />
                        {language === 'zh' ? '新建图表' : 'New Chart'}
                    </Button>
                </div>
            )}
        </div>
    )
}
