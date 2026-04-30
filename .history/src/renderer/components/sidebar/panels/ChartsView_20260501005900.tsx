import { useState } from 'react'
import { BarChart3, LineChart, PieChart, ScatterChart, AreaChart, Plus, Grid3x3, List } from 'lucide-react'
import { useStore } from '@store'
import { Button } from '../../ui'

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

const DEMO_CHARTS: ChartItem[] = [
    { id: '1', name: 'Sales Overview', type: 'bar', source: 'workspace', createdAt: '2026-04-28' },
    { id: '2', name: 'Revenue Trend', type: 'line', source: 'workspace', createdAt: '2026-04-27' },
    { id: '3', name: 'Market Share', type: 'pie', source: 'SQLite Local', createdAt: '2026-04-25' },
]

export function ChartsView() {
    const language = useStore(s => s.language)
    const [charts] = useState<ChartItem[]>(DEMO_CHARTS)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

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
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={language === 'zh' ? '新建图表' : 'New Chart'}>
                        <Plus className="w-3 h-3" />
                    </Button>
                </div>
            </div>

            {charts.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
                    <BarChart3 className="w-10 h-10 text-text-muted/30" />
                    <p className="text-xs text-text-muted text-center">
                        {language === 'zh' ? '暂无图表，点击 + 创建' : 'No charts yet. Click + to create one.'}
                    </p>
                </div>
            ) : viewMode === 'list' ? (
                <div className="flex-1 overflow-y-auto">
                    {charts.map((chart) => {
                        const Icon = CHART_TYPE_ICON[chart.type]
                        return (
                            <button
                                key={chart.id}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                            >
                                <Icon className="w-4 h-4 text-accent/70 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-text-primary truncate">{chart.name}</div>
                                    <div className="text-[10px] text-text-muted flex items-center gap-2">
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
                    })}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-2">
                    <div className="grid grid-cols-2 gap-2">
                        {charts.map((chart) => {
                            const Icon = CHART_TYPE_ICON[chart.type]
                            return (
                                <button
                                    key={chart.id}
                                    className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-border/30 hover:bg-surface-hover transition-colors aspect-square"
                                >
                                    <Icon className="w-6 h-6 text-accent/60" />
                                    <span className="text-[11px] text-text-primary truncate w-full text-center">{chart.name}</span>
                                    <span className="text-[9px] text-text-muted">{typeLabel(chart.type)}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            <div className="px-3 py-2 border-t border-border/30">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-xs gap-1.5"
                >
                    <Plus className="w-3 h-3" />
                    {language === 'zh' ? '新建图表' : 'New Chart'}
                </Button>
            </div>
        </div>
    )
}
