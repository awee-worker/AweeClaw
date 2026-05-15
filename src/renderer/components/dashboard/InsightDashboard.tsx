import { BarChart3, Database, FileSpreadsheet, TrendingUp, PieChart, Activity, Upload, MessageSquare } from 'lucide-react'
import { useStore } from '@store'

export default function DataDashboard() {
    const language = useStore(s => s.language)
    const workspace = useStore(s => s.workspace)
    const setActiveSidePanel = useStore(s => s.setActiveSidePanel)

    const quickActions = [
        {
            icon: Upload,
            label: language === 'zh' ? '导入数据' : 'Import Data',
            desc: language === 'zh' ? 'CSV, Excel, JSON 文件' : 'CSV, Excel, JSON files',
            onClick: () => setActiveSidePanel('data-sources'),
        },
        {
            icon: BarChart3,
            label: language === 'zh' ? '创建图表' : 'Create Chart',
            desc: language === 'zh' ? '柱状图、折线图、饼图等' : 'Bar, Line, Pie and more',
            onClick: () => setActiveSidePanel('charts'),
        },
        {
            icon: MessageSquare,
            label: language === 'zh' ? '开始分析' : 'Start Analysis',
            desc: language === 'zh' ? '与 AI 对话分析数据' : 'Chat with AI to analyze data',
            onClick: () => {},
        },
    ]

    const statsCards = [
        { icon: Database, label: language === 'zh' ? '数据源' : 'Data Sources', value: '0', color: 'text-blue-400' },
        { icon: BarChart3, label: language === 'zh' ? '图表' : 'Charts', value: '0', color: 'text-green-400' },
        { icon: FileSpreadsheet, label: language === 'zh' ? '数据集' : 'Datasets', value: '0', color: 'text-purple-400' },
        { icon: Activity, label: language === 'zh' ? '分析任务' : 'Tasks', value: '0', color: 'text-amber-400' },
    ]

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-2xl w-full space-y-8">
                <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                        <TrendingUp className="w-8 h-8 text-accent" />
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        {language === 'zh' ? '数据分析工作台' : 'Data Analysis Workspace'}
                    </h1>
                    <p className="text-sm text-text-muted max-w-md mx-auto">
                        {language === 'zh'
                            ? '导入数据、创建可视化图表、与 AI 协作进行深度分析'
                            : 'Import data, create visualizations, and collaborate with AI for deep analysis'}
                    </p>
                </div>

                <div className="grid grid-cols-4 gap-3">
                    {statsCards.map((card) => (
                        <div
                            key={card.label}
                            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 bg-surface/30"
                        >
                            <card.icon className={`w-5 h-5 ${card.color}`} />
                            <span className="text-lg font-semibold text-text-primary">{card.value}</span>
                            <span className="text-[11px] text-text-muted">{card.label}</span>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-3 gap-3">
                    {quickActions.map((action) => (
                        <button
                            key={action.label}
                            onClick={action.onClick}
                            className="flex flex-col items-center gap-2 p-5 rounded-xl border border-border/30 bg-surface/30 hover:bg-surface-hover hover:border-accent/30 transition-all group"
                        >
                            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                                <action.icon className="w-5 h-5 text-accent" />
                            </div>
                            <span className="text-sm font-medium text-text-primary">{action.label}</span>
                            <span className="text-[11px] text-text-muted text-center">{action.desc}</span>
                        </button>
                    ))}
                </div>

                {!workspace && (
                    <div className="text-center">
                        <p className="text-xs text-text-muted">
                            {language === 'zh'
                                ? '打开工作区以访问本地数据文件'
                                : 'Open a workspace to access local data files'}
                        </p>
                    </div>
                )}

                <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <PieChart className="w-4 h-4 text-accent/60" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '快速入门' : 'Quick Start'}
                        </span>
                    </div>
                    <div className="space-y-2 text-xs text-text-muted">
                        <p>1. {language === 'zh' ? '在左侧「数据源」面板中添加数据连接' : 'Add a data connection in the Data Sources panel'}</p>
                        <p>2. {language === 'zh' ? '在右侧对话中告诉 AI 你想分析什么' : 'Tell AI what you want to analyze in the chat'}</p>
                        <p>3. {language === 'zh' ? 'AI 将自动生成图表和分析结果' : 'AI will automatically generate charts and analysis results'}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
