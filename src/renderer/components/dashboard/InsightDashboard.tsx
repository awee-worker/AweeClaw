import { BarChart3, Database, FileSpreadsheet, TrendingUp, PieChart, Activity, Upload, MessageSquare } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

export default function DataDashboard() {
    const language = useStore(s => s.language)
    const workspace = useStore(s => s.workspace)
    const setActiveSidePanel = useStore(s => s.setActiveSidePanel)

    const quickActions = [
        {
            icon: Upload,
            label: t('dashboard.importdata', language as Language),
            desc: t('dashboard.csvexceljsonfiles', language as Language),
            onClick: () => setActiveSidePanel('data-sources'),
        },
        {
            icon: BarChart3,
            label: t('dashboard.createchart', language as Language),
            desc: t('dashboard.barlinepieandmore', language as Language),
            onClick: () => setActiveSidePanel('charts'),
        },
        {
            icon: MessageSquare,
            label: t('dashboard.startanalysis', language as Language),
            desc: t('dashboard.chatwithaitoanalyze', language as Language),
            onClick: () => {},
        },
    ]

    const statsCards = [
        { icon: Database, label: t('dashboard.datasources', language as Language), value: '0', color: 'text-blue-400' },
        { icon: BarChart3, label: t('dashboard.charts', language as Language), value: '0', color: 'text-green-400' },
        { icon: FileSpreadsheet, label: t('dashboard.datasets', language as Language), value: '0', color: 'text-purple-400' },
        { icon: Activity, label: t('dashboard.tasks', language as Language), value: '0', color: 'text-amber-400' },
    ]

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-2xl w-full space-y-8">
                <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                        <TrendingUp className="w-8 h-8 text-accent" />
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        {t('dashboard.dataanalysisworkspace', language as Language)}
                    </h1>
                    <p className="text-sm text-text-muted max-w-md mx-auto">
                        {t('dashboard.importdatacreatevisualizationsand', language as Language)}
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
                            {t('dashboard.openaworkspacetoaccess', language as Language)}
                        </p>
                    </div>
                )}

                <div className="rounded-xl border border-border/30 bg-surface/20 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <PieChart className="w-4 h-4 text-accent/60" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                            {t('dashboard.quickstart', language as Language)}
                        </span>
                    </div>
                    <div className="space-y-2 text-xs text-text-muted">
                        <p>1. {t('dashboard.addadataconnectionin', language as Language)}</p>
                        <p>2. {t('dashboard.tellaiwhatyouwant', language as Language)}</p>
                        <p>3. {t('dashboard.aiwillautomaticallygeneratecharts', language as Language)}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
