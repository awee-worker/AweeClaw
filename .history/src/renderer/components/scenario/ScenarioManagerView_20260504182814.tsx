import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import {
    Check, Sparkles, Code2, BarChart3, PenTool,
    Settings, Shield, MoreHorizontal, Package,
    BookOpen, Brain, Briefcase, Calculator, Calendar,
    Cpu, Database, FileText, FlaskConical, Globe,
    GraduationCap, Heart, Lightbulb, MessageSquare,
    Music, Palette, Rocket, Scale, Search,
    ShieldCheck, Stethoscope, TrendingUp, Users, Zap,
    PackageX, Download, Info, HardDrive, Tag,
    Layers, Activity, Loader2, FolderOpen, AlertCircle, CheckCircle2, XCircle,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/config/scenarios'
import { scenarioLoader } from '@/scenarios/core/ScenarioLoader'
import { api } from '@/renderer/services/electronAPI'
import { Button, Modal } from '../ui'
import ConfirmDialog from '../common/ConfirmDialog'
import type { ScenarioPlugin, UILayout, ScenarioCategory } from '@shared/types/scenario'
import type { ScenarioHealthReport } from '@shared/types/scenario-arch'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
    Code2, BarChart3, PenTool, Sparkles, Settings,
    BookOpen, Brain, Briefcase, Calculator, Calendar,
    Cpu, Database, FileText, FlaskConical, Globe,
    GraduationCap, Heart, Lightbulb, MessageSquare,
    Music, Palette, Rocket, Scale, Search,
    ShieldCheck, Stethoscope, TrendingUp, Users, Zap,
    Package, HardDrive,
}

const CATEGORY_LABELS: Record<string, { en: string; zh: string; color: string }> = {
    productivity: { en: 'Productivity', zh: '效率', color: 'text-blue-400' },
    development: { en: 'Development', zh: '开发', color: 'text-green-400' },
    data: { en: 'Data', zh: '数据', color: 'text-purple-400' },
    creative: { en: 'Creative', zh: '创意', color: 'text-pink-400' },
    education: { en: 'Education', zh: '教育', color: 'text-amber-400' },
    automation: { en: 'Automation', zh: '自动化', color: 'text-cyan-400' },
    research: { en: 'Research', zh: '研究', color: 'text-indigo-400' },
    communication: { en: 'Communication', zh: '沟通', color: 'text-sky-400' },
    entertainment: { en: 'Entertainment', zh: '娱乐', color: 'text-rose-400' },
    business: { en: 'Business', zh: '商业', color: 'text-emerald-400' },
    health: { en: 'Health', zh: '健康', color: 'text-teal-400' },
    finance: { en: 'Finance', zh: '金融', color: 'text-yellow-400' },
    legal: { en: 'Legal', zh: '法律', color: 'text-orange-400' },
    marketing: { en: 'Marketing', zh: '营销', color: 'text-violet-400' },
    energy: { en: 'Energy', zh: '能源', color: 'text-amber-500' },
    custom: { en: 'Custom', zh: '自定义', color: 'text-text-muted' },
}

const SOURCE_LABELS: Record<string, { en: string; zh: string; icon: LucideIcon }> = {
    builtin: { en: 'Built-in', zh: '内置', icon: Shield },
    marketplace: { en: 'Marketplace', zh: '市场', icon: Download },
    local: { en: 'Local', zh: '本地', icon: HardDrive },
    url: { en: 'URL', zh: '远程', icon: Globe },
}

const LAYOUT_ICONS: Record<UILayout, string> = {
    'editor-centric': '📝',
    'chat-centric': '💬',
    'canvas-centric': '🎨',
    'dashboard-centric': '📊',
    'analytics-centric': '📈',
    'research-centric': '🔬',
    'focus-centric': '🎯',
    'split-centric': '↔️',
    'fullscreen-chat': '🖥️',
    'minimal': '✨',
}

const HEALTH_STATUS_STYLES: Record<string, { color: string; bg: string }> = {
    healthy: { color: 'text-green-400', bg: 'bg-green-500/10' },
    degraded: { color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
    unhealthy: { color: 'text-red-400', bg: 'bg-red-500/10' },
}

const SCENARIO_SETTINGS_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType<{ scenarioId: string; onClose: () => void }>>> = {}

function getSettingsComponent(scenarioId: string) {
    if (!SCENARIO_SETTINGS_COMPONENTS[scenarioId]) {
        return null
    }
    return SCENARIO_SETTINGS_COMPONENTS[scenarioId]
}

export function registerScenarioSettingsComponent(
    scenarioId: string,
    component: React.LazyExoticComponent<React.ComponentType<{ scenarioId: string; onClose: () => void }>>
) {
    SCENARIO_SETTINGS_COMPONENTS[scenarioId] = component
}

export function ScenarioManagerView() {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const setSidebarWidth = useStore(s => s.setSidebarWidth)
    const prevWidthRef = useRef<number | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [filterCategory, setFilterCategory] = useState<string | null>(null)

    const [detailScenarioId, setDetailScenarioId] = useState<string | null>(null)
    const [settingsScenarioId, setSettingsScenarioId] = useState<string | null>(null)
    const [uninstallState, setUninstallState] = useState<{
        scenarioId: string
        scenarioName: string
        isConfirming: boolean
        isUninstalling: boolean
    } | null>(null)

    const [healthReport, setHealthReport] = useState<ScenarioHealthReport | null>(null)
    const [isLoadingHealth, setIsLoadingHealth] = useState(false)

    const [installState, setInstallState] = useState<{
        phase: 'idle' | 'selecting' | 'reading' | 'confirming' | 'installing' | 'success' | 'error'
        sourceDir: string | null
        config: Record<string, unknown> | null
        scenarioId: string | null
        error: string | null
    }>({ phase: 'idle', sourceDir: null, config: null, scenarioId: null, error: null })

    useEffect(() => {
        const currentWidth = useStore.getState().sidebarWidth
        if (currentWidth < 420) {
            prevWidthRef.current = currentWidth
            setSidebarWidth(420)
        }
        return () => {
            if (prevWidthRef.current !== null) {
                setSidebarWidth(prevWidthRef.current)
            }
        }
    }, [setSidebarWidth])

    const scenarios = scenarioRegistry.getInstalled()
    const builtinScenarios = scenarios.filter(s => s.isBuiltin)
    const installedScenarios = scenarios.filter(s => !s.isBuiltin)

    const filteredBuiltin = filterCategory
        ? builtinScenarios.filter(s => s.category === filterCategory)
        : builtinScenarios
    const filteredInstalled = filterCategory
        ? installedScenarios.filter(s => s.category === filterCategory)
        : installedScenarios

    const handleSwitch = useCallback((scenario: ScenarioPlugin) => {
        scenarioRegistry.setActive(scenario.id)
        useStore.getState().set('activeScenarioId', scenario.id)
    }, [])

    const handleOpenDetail = useCallback(async (scenarioId: string) => {
        setDetailScenarioId(scenarioId)
        setIsLoadingHealth(true)
        setHealthReport(null)
        try {
            const report = await scenarioLoader.healthCheck(scenarioId)
            setHealthReport(report)
        } catch {
            setHealthReport(null)
        } finally {
            setIsLoadingHealth(false)
        }
    }, [])

    const handleOpenSettings = useCallback((scenarioId: string) => {
        setSettingsScenarioId(scenarioId)
    }, [])

    const handleRequestUninstall = useCallback((scenario: ScenarioPlugin) => {
        setUninstallState({
            scenarioId: scenario.id,
            scenarioName: language === 'zh' ? scenario.nameZh : scenario.name,
            isConfirming: true,
            isUninstalling: false,
        })
    }, [language])

    const handleConfirmUninstall = useCallback(async () => {
        if (!uninstallState) return
        setUninstallState(prev => prev ? { ...prev, isConfirming: false, isUninstalling: true } : null)

        try {
            if (scenarioLoader.has(uninstallState.scenarioId)) {
                const entry = scenarioLoader.getEntry(uninstallState.scenarioId)
                if (entry?.state === 'activated') {
                    await scenarioLoader.deactivate(uninstallState.scenarioId)
                }
                await scenarioLoader.uninstall(uninstallState.scenarioId)
            }

            await scenarioRegistry.uninstallScenario(uninstallState.scenarioId)

            try {
                await api.scenarioInstall.deleteScenarioDir(uninstallState.scenarioId)
            } catch {
                // ignore dir deletion errors
            }
        } catch (err) {
            console.error('[ScenarioManager] Uninstall failed:', err)
        } finally {
            setUninstallState(null)
            setExpandedId(null)
        }
    }, [uninstallState])

    const handleCancelUninstall = useCallback(() => {
        setUninstallState(null)
    }, [])

    const handleInstallScenario = useCallback(async () => {
        setInstallState({ phase: 'selecting', sourceDir: null, config: null, scenarioId: null, error: null })

        try {
            const selectedDir = await api.scenarioInstall.selectScenarioDir()
            if (!selectedDir) {
                setInstallState(prev => prev.phase !== 'idle' ? { ...prev, phase: 'idle' } : prev)
                return
            }

            setInstallState(prev => ({ ...prev, phase: 'reading', sourceDir: selectedDir }))

            const result = await api.scenarioInstall.readScenarioConfig(selectedDir)
            if (!result.success || !result.config) {
                setInstallState(prev => ({
                    ...prev,
                    phase: 'error',
                    error: result.error || 'Failed to read scenario config',
                }))
                return
            }

            const config = result.config
            const scenarioId = config.id as string

            if (scenarioRegistry.has(scenarioId)) {
                setInstallState(prev => ({
                    ...prev,
                    phase: 'error',
                    config,
                    scenarioId,
                    error: language === 'zh'
                        ? `场景「${config.nameZh || config.name}」已安装，请先卸载后再重新安装`
                        : `Scenario "${config.name}" is already installed. Please uninstall first.`,
                }))
                return
            }

            setInstallState(prev => ({ ...prev, phase: 'confirming', config, scenarioId }))
        } catch (err) {
            setInstallState(prev => ({
                ...prev,
                phase: 'error',
                error: err instanceof Error ? err.message : String(err),
            }))
        }
    }, [language])

    const handleConfirmInstall = useCallback(async () => {
        if (!installState.sourceDir || !installState.config) return

        setInstallState(prev => ({ ...prev, phase: 'installing' }))

        try {
            const installResult = await api.scenarioInstall.installFromLocal(installState.sourceDir)
            if (!installResult.success) {
                setInstallState(prev => ({
                    ...prev,
                    phase: 'error',
                    error: installResult.error || 'Installation failed',
                }))
                return
            }

            const config = installResult.config || installState.config
            const scenarioId = installResult.scenarioId || (config.id as string)

            const plugin: ScenarioPlugin = {
                id: scenarioId,
                name: (config.name as string) || scenarioId,
                nameZh: (config.nameZh as string) || (config.name as string) || scenarioId,
                icon: (config.icon as string) || 'Package',
                description: (config.description as string) || '',
                descriptionZh: (config.descriptionZh as string) || (config.description as string) || '',
                version: (config.version as string) || '1.0.0',
                author: (config.author as string) || 'unknown',
                category: (config.category as ScenarioCategory) || 'custom',
                tags: (config.tags as string[]) || [],
                source: 'local',
                hasSettings: (config.hasSettings as boolean) || false,
                requiresWorkspace: (config.requiresWorkspace as boolean) || false,
                isBuiltin: false,
                identity: (config.identity as ScenarioPlugin['identity']) || {
                    systemPrompt: '',
                    securityRules: '',
                    conventions: '',
                    workflow: '',
                },
                capabilities: (config.capabilities as ScenarioPlugin['capabilities']) || {
                    toolPacks: [],
                    modes: [],
                    contextTypes: [],
                    outputFormats: [],
                },
                ui: (config.ui as ScenarioPlugin['ui']) || {
                    layout: 'chat-centric' as UILayout,
                    panels: [],
                    sidebarItems: [],
                    statusBarItems: [],
                },
                dataSources: (config.dataSources as ScenarioPlugin['dataSources']) || {
                    workspace: false,
                },
            }

            scenarioRegistry.registerAndPersist(plugin)

            const installScripts = config.installScripts as Array<{ id: string; description?: string; sql: string }> | undefined
            if (installScripts && installScripts.length > 0) {
                await api.scenarioDb.initialize({
                    scenarioId,
                    installScripts,
                })
            }

            setInstallState(prev => ({ ...prev, phase: 'success', scenarioId }))
        } catch (err) {
            setInstallState(prev => ({
                ...prev,
                phase: 'error',
                error: err instanceof Error ? err.message : String(err),
            }))
        }
    }, [installState.sourceDir, installState.config])

    const handleCloseInstall = useCallback(() => {
        setInstallState({ phase: 'idle', sourceDir: null, config: null, scenarioId: null, error: null })
    }, [])

    const usedCategories = [...new Set(scenarios.map(s => s.category))]
    const sortedCategories = usedCategories.sort((a, b) => {
        const aLabel = CATEGORY_LABELS[a]?.zh || a
        const bLabel = CATEGORY_LABELS[b]?.zh || b
        return aLabel.localeCompare(bLabel)
    })

    const detailScenario = detailScenarioId ? scenarioRegistry.get(detailScenarioId) : null
    const detailManifest = detailScenarioId ? scenarioLoader.getManifest(detailScenarioId) : null
    const detailEntry = detailScenarioId ? scenarioLoader.getEntry(detailScenarioId) : null

    const settingsScenario = settingsScenarioId ? scenarioRegistry.get(settingsScenarioId) : null
    const SettingsComponent = settingsScenarioId ? getSettingsComponent(settingsScenarioId) : null

    const renderScenarioCard = (scenario: ScenarioPlugin) => {
        const IconComponent = ICON_MAP[scenario.icon] || Sparkles
        const isActive = scenario.id === activeScenarioId
        const isBuiltin = scenario.isBuiltin === true
        const catLabel = CATEGORY_LABELS[scenario.category] || CATEGORY_LABELS.custom
        const layoutIcon = LAYOUT_ICONS[scenario.ui.layout] || '✨'
        const isExpanded = expandedId === scenario.id
        const sourceInfo = SOURCE_LABELS[scenario.source || (isBuiltin ? 'builtin' : 'local')]
        const SourceIcon = sourceInfo?.icon || Package
        const showSettings = scenario.hasSettings === true

        return (
            <div
                key={scenario.id}
                className={`
                    rounded-xl border transition-all duration-200 overflow-hidden
                    ${isActive
                        ? 'border-accent/30 bg-accent/[0.06] shadow-sm shadow-accent/5'
                        : 'border-border/20 bg-surface/20 hover:bg-surface/40 hover:border-border/40'}
                `}
            >
                <div
                    className="px-3.5 py-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : scenario.id)}
                >
                    <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-accent/15' : 'bg-surface/60'}`}>
                            <IconComponent className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={`text-[13px] font-medium truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                                    {language === 'zh' ? scenario.nameZh : scenario.name}
                                </span>
                                {isActive && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                                        <Check className="w-2.5 h-2.5" strokeWidth={2.5} />
                                        {language === 'zh' ? '当前' : 'Active'}
                                    </span>
                                )}
                                {isBuiltin && (
                                    <Shield className="w-3 h-3 text-amber-400/50 flex-shrink-0" strokeWidth={1.5} />
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[11px] font-medium ${catLabel.color}`}>
                                    {language === 'zh' ? catLabel.zh : catLabel.en}
                                </span>
                                <span className="text-[11px] text-text-muted/85">·</span>
                                <span className="text-[11px] text-text-muted/85">
                                    {layoutIcon} {scenario.ui.layout.replace('-', ' ')}
                                </span>
                                <span className="text-[11px] text-text-muted/85">·</span>
                                <span className="text-[11px] text-text-muted/85 flex items-center gap-0.5">
                                    <SourceIcon className="w-2.5 h-2.5" />
                                    {language === 'zh' ? sourceInfo?.zh : sourceInfo?.en}
                                </span>
                            </div>
                        </div>
                        <MoreHorizontal className={`w-4 h-4 text-text-muted/75 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                </div>

                {isExpanded && (
                    <div className="px-3.5 pb-3 border-t border-border/10 pt-2.5">
                        <p className="text-[12px] text-text-secondary leading-relaxed mb-1">
                            {language === 'zh' ? scenario.descriptionZh : scenario.description}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-text-muted/85 mb-3">
                            <span>v{scenario.version}</span>
                            <span>·</span>
                            <span>{scenario.author}</span>
                            {scenario.installSize && (
                                <>
                                    <span>·</span>
                                    <span>{scenario.installSize}</span>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {!isActive && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="h-7 text-[12px] gap-1.5 px-3 rounded-lg"
                                    onClick={(e) => { e.stopPropagation(); handleSwitch(scenario) }}
                                >
                                    <Check className="w-3 h-3" />
                                    {language === 'zh' ? '切换' : 'Switch'}
                                </Button>
                            )}
                            {showSettings && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[12px] gap-1.5 px-3 rounded-lg"
                                    onClick={(e) => { e.stopPropagation(); handleOpenSettings(scenario.id) }}
                                >
                                    <Settings className="w-3 h-3" />
                                    {language === 'zh' ? '设置' : 'Settings'}
                                </Button>
                            )}
                            {!isBuiltin && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[12px] gap-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-400/10"
                                    onClick={(e) => { e.stopPropagation(); handleRequestUninstall(scenario) }}
                                >
                                    <PackageX className="w-3 h-3" />
                                    {language === 'zh' ? '卸载' : 'Uninstall'}
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[12px] gap-1.5 px-3 rounded-lg ml-auto"
                                onClick={(e) => { e.stopPropagation(); handleOpenDetail(scenario.id) }}
                            >
                                <Info className="w-3 h-3" />
                                {language === 'zh' ? '详情' : 'Details'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                <div>
                    <h2 className="text-sm font-semibold text-text-primary">
                        {language === 'zh' ? '场景管理' : 'Scenarios'}
                    </h2>
                    <p className="text-[11px] text-text-muted mt-0.5">
                        {language === 'zh'
                            ? `${scenarios.length} 个已安装场景`
                            : `${scenarios.length} installed`}
                    </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={handleInstallScenario} title={language === 'zh' ? '安装场景' : 'Install Scenario'}>
                    <Download className="w-4 h-4" />
                </Button>
            </div>

            {sortedCategories.length > 1 && (
                <div className="px-3 py-2 border-b border-border/10 flex items-center gap-1 overflow-x-auto">
                    <button
                        onClick={() => setFilterCategory(null)}
                        className={`text-[11px] px-2 py-1 rounded-md whitespace-nowrap transition-all ${!filterCategory ? 'bg-accent/15 text-accent border border-accent/30' : 'text-text-muted hover:text-text-primary border border-transparent'}`}
                    >
                        {language === 'zh' ? '全部' : 'All'}
                    </button>
                    {sortedCategories.map(cat => {
                        const catLabel = CATEGORY_LABELS[cat] || CATEGORY_LABELS.custom
                        return (
                            <button
                                key={cat}
                                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                                className={`text-[11px] px-2 py-1 rounded-md whitespace-nowrap transition-all ${filterCategory === cat ? 'bg-accent/15 text-accent border border-accent/30' : `${catLabel.color} hover:opacity-80 border border-transparent`}`}
                            >
                                {language === 'zh' ? catLabel.zh : catLabel.en}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {filteredBuiltin.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 px-1 mb-2">
                            <Shield className="w-3 h-3 text-amber-400/60" strokeWidth={1.5} />
                            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                                {language === 'zh' ? '内置场景' : 'Built-in'}
                            </span>
                            <span className="text-[10px] text-text-muted/60">({filteredBuiltin.length})</span>
                        </div>
                        <div className="space-y-2">
                            {filteredBuiltin.map(renderScenarioCard)}
                        </div>
                    </div>
                )}

                {filteredInstalled.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 px-1 mb-2">
                            <Package className="w-3 h-3 text-accent/60" strokeWidth={1.5} />
                            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                                {language === 'zh' ? '已安装场景' : 'Installed'}
                            </span>
                            <span className="text-[10px] text-text-muted/60">({filteredInstalled.length})</span>
                        </div>
                        <div className="space-y-2">
                            {filteredInstalled.map(renderScenarioCard)}
                        </div>
                    </div>
                )}

                {scenarios.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Package className="w-10 h-10 text-text-muted/30 mb-3" strokeWidth={1} />
                        <p className="text-sm text-text-muted/60">
                            {language === 'zh' ? '暂无已安装的场景' : 'No scenarios installed'}
                        </p>
                    </div>
                )}
            </div>

            <div className="px-3 py-2.5 border-t border-border/20">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full text-xs gap-1.5 rounded-lg border border-dashed border-border/30 hover:border-accent/30 hover:text-accent"
                    onClick={handleInstallScenario}
                >
                    <Download className="w-3.5 h-3.5" />
                    {language === 'zh' ? '安装场景' : 'Install Scenario'}
                </Button>
            </div>

            {installState.phase !== 'idle' && (
                <Modal
                    isOpen
                    onClose={handleCloseInstall}
                    title={language === 'zh' ? '安装场景' : 'Install Scenario'}
                    size="md"
                >
                    {installState.phase === 'selecting' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <FolderOpen className="w-8 h-8 text-accent/60" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {language === 'zh' ? '请选择场景目录...' : 'Select scenario directory...'}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'reading' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {language === 'zh' ? '正在读取场景配置...' : 'Reading scenario config...'}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'confirming' && installState.config && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                                    <Package className="w-5 h-5 text-accent" strokeWidth={1.5} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-medium text-text-primary">
                                        {language === 'zh' ? (installState.config.nameZh as string) : (installState.config.name as string)}
                                    </h4>
                                    <p className="text-[11px] text-text-muted">
                                        v{installState.config.version as string} · {installState.config.author as string}
                                    </p>
                                </div>
                            </div>
                            <p className="text-[12px] text-text-secondary">
                                {installState.config.description as string}
                            </p>
                            <div className="flex items-center gap-2 justify-end">
                                <Button variant="ghost" size="sm" onClick={handleCloseInstall}>
                                    {language === 'zh' ? '取消' : 'Cancel'}
                                </Button>
                                <Button variant="primary" size="sm" onClick={handleConfirmInstall}>
                                    {language === 'zh' ? '确认安装' : 'Install'}
                                </Button>
                            </div>
                        </div>
                    )}
                    {installState.phase === 'installing' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {language === 'zh' ? '正在安装场景...' : 'Installing scenario...'}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'success' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <CheckCircle2 className="w-8 h-8 text-green-400" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {language === 'zh' ? '安装成功！' : 'Installed successfully!'}
                            </p>
                            <Button variant="primary" size="sm" onClick={handleCloseInstall}>
                                {language === 'zh' ? '完成' : 'Done'}
                            </Button>
                        </div>
                    )}
                    {installState.phase === 'error' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <XCircle className="w-8 h-8 text-red-400" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {language === 'zh' ? '安装失败' : 'Installation Failed'}
                            </p>
                            <p className="text-[12px] text-text-muted max-w-md text-center">
                                {installState.error}
                            </p>
                            <Button variant="primary" size="sm" onClick={handleCloseInstall}>
                                {language === 'zh' ? '关闭' : 'Close'}
                            </Button>
                        </div>
                    )}
                </Modal>
            )}

            <ConfirmDialog
                isOpen={uninstallState?.isConfirming === true}
                title={language === 'zh' ? '确认卸载' : 'Confirm Uninstall'}
                message={language === 'zh'
                    ? `确定要卸载场景「${uninstallState?.scenarioName}」吗？卸载将删除场景文件、数据库及所有相关数据，此操作不可恢复。`
                    : `Are you sure you want to uninstall "${uninstallState?.scenarioName}"? This will remove scenario files, database, and all related data. This action cannot be undone.`
                }
                confirmText={language === 'zh' ? '确认卸载' : 'Uninstall'}
                cancelText={language === 'zh' ? '取消' : 'Cancel'}
                variant="danger"
                onConfirm={handleConfirmUninstall}
                onCancel={handleCancelUninstall}
            />

            {uninstallState?.isUninstalling && (
                <Modal isOpen onClose={() => {}} showCloseButton={false} size="sm">
                    <div className="flex flex-col items-center justify-center py-6 gap-3">
                        <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                        <p className="text-sm text-text-secondary">
                            {language === 'zh'
                                ? `正在卸载「${uninstallState.scenarioName}」...`
                                : `Uninstalling "${uninstallState.scenarioName}"...`
                            }
                        </p>
                        <p className="text-[11px] text-text-muted">
                            {language === 'zh' ? '正在执行卸载脚本并清理数据' : 'Running uninstall scripts and cleaning up data'}
                        </p>
                    </div>
                </Modal>
            )}

            <Modal
                isOpen={detailScenarioId !== null}
                onClose={() => { setDetailScenarioId(null); setHealthReport(null) }}
                title={language === 'zh' ? '场景详情' : 'Scenario Details'}
                size="lg"
            >
                {detailScenario && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                                {(() => {
                                    const Icon = ICON_MAP[detailScenario.icon] || Sparkles
                                    return <Icon className="w-7 h-7 text-accent" strokeWidth={1.5} />
                                })()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-bold text-text-primary">
                                        {language === 'zh' ? detailScenario.nameZh : detailScenario.name}
                                    </h3>
                                    {detailScenario.isBuiltin && (
                                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">
                                            <Shield className="w-2.5 h-2.5" />
                                            {language === 'zh' ? '内置' : 'Built-in'}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary mt-1">
                                    {language === 'zh' ? detailScenario.descriptionZh : detailScenario.description}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <InfoItem label={language === 'zh' ? '版本' : 'Version'} value={`v${detailScenario.version}`} />
                            <InfoItem label={language === 'zh' ? '作者' : 'Author'} value={detailScenario.author} />
                            <InfoItem
                                label={language === 'zh' ? '分类' : 'Category'}
                                value={CATEGORY_LABELS[detailScenario.category]?.[language === 'zh' ? 'zh' : 'en'] || detailScenario.category}
                            />
                            <InfoItem
                                label={language === 'zh' ? '来源' : 'Source'}
                                value={SOURCE_LABELS[detailScenario.source || (detailScenario.isBuiltin ? 'builtin' : 'local')]?.[language === 'zh' ? 'zh' : 'en'] || '-'}
                            />
                            <InfoItem
                                label={language === 'zh' ? '布局' : 'Layout'}
                                value={`${LAYOUT_ICONS[detailScenario.ui.layout] || ''} ${detailScenario.ui.layout}`}
                            />
                            <InfoItem
                                label={language === 'zh' ? '需要工作区' : 'Workspace'}
                                value={detailScenario.requiresWorkspace
                                    ? (language === 'zh' ? '是' : 'Yes')
                                    : (language === 'zh' ? '否' : 'No')
                                }
                            />
                        </div>

                        {detailScenario.tags.length > 0 && (
                            <div>
                                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Tag className="w-3 h-3" />
                                    {language === 'zh' ? '标签' : 'Tags'}
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {detailScenario.tags.map(tag => (
                                        <span key={tag} className="text-[11px] px-2 py-0.5 rounded-md bg-surface/60 text-text-muted border border-border/20">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {detailManifest && (
                            <>
                                {detailManifest.permissions && detailManifest.permissions.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <ShieldCheck className="w-3 h-3" />
                                            {language === 'zh' ? '权限' : 'Permissions'}
                                        </h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {detailManifest.permissions.map(perm => (
                                                <span key={perm} className="text-[11px] px-2 py-0.5 rounded-md bg-surface/60 text-text-muted border border-border/20 font-mono">
                                                    {perm}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {detailManifest.dependencies && detailManifest.dependencies.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Layers className="w-3 h-3" />
                                            {language === 'zh' ? '依赖' : 'Dependencies'}
                                        </h4>
                                        <div className="space-y-1">
                                            {detailManifest.dependencies.map(dep => (
                                                <div key={dep.id} className="flex items-center gap-2 text-[12px]">
                                                    <span className="text-text-primary font-mono">{dep.id}</span>
                                                    {dep.versionRange && (
                                                        <span className="text-text-muted">{dep.versionRange}</span>
                                                    )}
                                                    {dep.required === false && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface/40 text-text-muted">
                                                            {language === 'zh' ? '可选' : 'optional'}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        <div>
                            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Activity className="w-3 h-3" />
                                {language === 'zh' ? '运行状态' : 'Runtime Status'}
                            </h4>
                            {isLoadingHealth ? (
                                <div className="flex items-center gap-2 text-[12px] text-text-muted">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {language === 'zh' ? '检查中...' : 'Checking...'}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-[12px]">
                                        <span className="text-text-muted">{language === 'zh' ? '状态' : 'State'}:</span>
                                        <StateBadge state={detailEntry?.state || 'unregistered'} language={language} />
                                    </div>
                                    {healthReport && healthReport.checks.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {healthReport.checks.map((check, i) => {
                                                const style = HEALTH_STATUS_STYLES[check.status] || HEALTH_STATUS_STYLES.healthy
                                                return (
                                                    <div key={i} className="flex items-center gap-2 text-[12px]">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${style.bg} ${style.color}`} />
                                                        <span className="text-text-muted">{check.name}:</span>
                                                        <span className={style.color}>{check.status}</span>
                                                        {check.message && (
                                                            <span className="text-text-muted/70">({check.message})</span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                    {healthReport && (
                                        <div className="flex items-center gap-4 text-[11px] text-text-muted mt-2">
                                            <span>{language === 'zh' ? '工具' : 'Tools'}: {healthReport.toolCount}</span>
                                            <span>{language === 'zh' ? '组件' : 'Components'}: {healthReport.componentCount}</span>
                                            {healthReport.uptime != null && (
                                                <span>{language === 'zh' ? '运行时间' : 'Uptime'}: {formatUptime(healthReport.uptime, language)}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {detailScenario.capabilities && (
                            <div>
                                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" />
                                    {language === 'zh' ? '能力' : 'Capabilities'}
                                </h4>
                                <div className="space-y-2">
                                    {detailScenario.capabilities.toolPacks.length > 0 && (
                                        <div>
                                            <span className="text-[11px] text-text-muted">{language === 'zh' ? '工具包' : 'Tool Packs'}:</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {detailScenario.capabilities.toolPacks.map(tp => (
                                                    <span key={tp} className="text-[11px] px-2 py-0.5 rounded-md bg-accent/5 text-accent/80 border border-accent/10">
                                                        {tp}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {detailScenario.capabilities.modes.length > 0 && (
                                        <div>
                                            <span className="text-[11px] text-text-muted">{language === 'zh' ? '工作模式' : 'Modes'}:</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {detailScenario.capabilities.modes.map(m => (
                                                    <span key={m.id} className="text-[11px] px-2 py-0.5 rounded-md bg-surface/60 text-text-muted border border-border/20">
                                                        {language === 'zh' ? m.labelZh : m.label}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {detailManifest?.homepage && (
                            <div className="pt-2 border-t border-border/10">
                                <a
                                    href={detailManifest.homepage}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[12px] text-accent hover:underline flex items-center gap-1"
                                >
                                    <Globe className="w-3 h-3" />
                                    {language === 'zh' ? '主页' : 'Homepage'}
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={settingsScenarioId !== null}
                onClose={() => setSettingsScenarioId(null)}
                title={language === 'zh'
                    ? `设置 - ${settingsScenario ? (language === 'zh' ? settingsScenario.nameZh : settingsScenario.name) : ''}`
                    : `Settings - ${settingsScenario ? settingsScenario.name : ''}`
                }
                size="md"
            >
                {settingsScenario && SettingsComponent ? (
                    <Suspense fallback={
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-5 h-5 text-accent animate-spin" />
                        </div>
                    }>
                        <SettingsComponent scenarioId={settingsScenarioId!} onClose={() => setSettingsScenarioId(null)} />
                    </Suspense>
                ) : settingsScenario && !SettingsComponent ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Settings className="w-10 h-10 text-text-muted/30 mb-3" strokeWidth={1} />
                        <p className="text-sm text-text-muted/60">
                            {language === 'zh'
                                ? `场景「${settingsScenario.nameZh}」暂未提供设置面板`
                                : `Scenario "${settingsScenario.name}" does not provide a settings panel`
                            }
                        </p>
                        <p className="text-[11px] text-text-muted/40 mt-1">
                            {language === 'zh'
                                ? '开发者可以通过 registerScenarioSettingsComponent 注册设置组件'
                                : 'Developers can register a settings component via registerScenarioSettingsComponent'
                            }
                        </p>
                    </div>
                ) : null}
            </Modal>
        </div>
    )
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="px-3 py-2 rounded-lg bg-surface/30 border border-border/10">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">{label}</div>
            <div className="text-[12px] text-text-primary font-medium">{value}</div>
        </div>
    )
}

function StateBadge({ state, language }: { state: string; language: string }) {
    const stateMap: Record<string, { label: string; labelZh: string; color: string }> = {
        registered: { label: 'Registered', labelZh: '已注册', color: 'text-blue-400 bg-blue-500/10' },
        activating: { label: 'Activating', labelZh: '激活中', color: 'text-yellow-400 bg-yellow-500/10' },
        activated: { label: 'Activated', labelZh: '已激活', color: 'text-green-400 bg-green-500/10' },
        deactivating: { label: 'Deactivating', labelZh: '停用中', color: 'text-yellow-400 bg-yellow-500/10' },
        deactivated: { label: 'Deactivated', labelZh: '已停用', color: 'text-text-muted bg-surface/40' },
        error: { label: 'Error', labelZh: '错误', color: 'text-red-400 bg-red-500/10' },
        unregistered: { label: 'Unregistered', labelZh: '未注册', color: 'text-text-muted bg-surface/40' },
    }
    const info = stateMap[state] || stateMap.unregistered
    return (
        <span className={`text-[11px] px-2 py-0.5 rounded-md ${info.color}`}>
            {language === 'zh' ? info.labelZh : info.label}
        </span>
    )
}

function formatUptime(ms: number, language: string): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return language === 'zh' ? `${seconds}秒` : `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return language === 'zh' ? `${minutes}分钟` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return language === 'zh' ? `${hours}小时` : `${hours}h`
}
