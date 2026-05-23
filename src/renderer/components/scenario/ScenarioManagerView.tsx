import { useState, useCallback, useEffect, Suspense } from 'react'
import {
    Check, Sparkles, Code2, BarChart3, PenTool,
    Settings, Shield, Package,
    BookOpen, Brain, Briefcase, Calculator, Calendar,
    Cpu, Database, FileText, FlaskConical, Globe,
    GraduationCap, Heart, Lightbulb, MessageSquare,
    Music, Palette, Rocket, Scale, Search,
    ShieldCheck, Stethoscope, TrendingUp, Users, Zap,
    PackageX, Download, Info, HardDrive, Tag,
    Layers, Activity, Loader2, FolderOpen, CheckCircle2, XCircle,
    AlertTriangle, RotateCcw, Star, RefreshCw, ArrowLeft, Clock,
    ChevronRight, X, ArrowUpCircle, AlertCircle,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core/ScenarioLoader'
import { DeclarativeScenarioModule } from '@scenario-system/core/DeclarativeScenarioModule'
import { api } from '../../adapters/electronBridge'
import { ActionButton, OverlayDialog } from '../ui'
import DecisionOverlay from '@components/foundation/DecisionOverlay'
import { PermissionConfirmDialog } from './PermissionConfirmDialog'
import { ScenarioReviewPanel } from './ScenarioReviewPanel'
import type { ScenarioPlugin, UILayout, ScenarioCategory } from '@shared/protocols/scenario'
import { activateScenarioPanels, switchToFirstPanel } from './panelUtils'
import type { ScenarioHealthReport } from '@shared/protocols/scenario-arch'
import type { LucideIcon } from 'lucide-react'
import {
    browseScenarios,
    getFeaturedScenarios,
    getMarketplaceCategories,
    installScenarioFromMarketplace,
    checkScenarioUpdates,
    updateScenarioFromMarketplace,
} from '@services/marketplaceService'
import type {
    MarketplaceScenario,
    MarketplaceCategory,
    MarketplaceUpdateInfo,
} from '@scenario-system/marketplace'
import { toast } from '../foundation/NotificationProvider'

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

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    development: <Code2 className="w-4 h-4" />,
    data: <BarChart3 className="w-4 h-4" />,
    creative: <PenTool className="w-4 h-4" />,
    productivity: <Zap className="w-4 h-4" />,
    education: <GraduationCap className="w-4 h-4" />,
    business: <TrendingUp className="w-4 h-4" />,
    health: <Stethoscope className="w-4 h-4" />,
    legal: <Scale className="w-4 h-4" />,
    research: <BookOpen className="w-4 h-4" />,
    lifestyle: <Heart className="w-4 h-4" />,
    custom: <Sparkles className="w-4 h-4" />,
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

type ManagerTab = 'installed' | 'marketplace'

export function ScenarioManagerView() {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const isAuthenticated = useStore(s => s.isAuthenticated)
    const setActiveSidePanel = useStore(s => s.setActiveSidePanel)
    const [activeTab, setActiveTab] = useState<ManagerTab>('installed')
    const [filterCategory, setFilterCategory] = useState<string | null>(null)

    const [scenarioUpdates, setScenarioUpdates] = useState<Map<string, MarketplaceUpdateInfo>>(new Map())
    const [updatingScenarioId, setUpdatingScenarioId] = useState<string | null>(null)
    function translateInstallError(error: string): string {
        if (language !== 'zh') return error
        const map: Record<string, string> = {
            'Package archive is corrupted or in an unsupported format. Please verify the scenario package.': '安装包已损坏或格式不受支持，请检查场景包是否正确。',
            'Package archive is corrupted or contains invalid entries. Please verify the scenario package.': '安装包已损坏或包含无效内容，请检查场景包是否正确。',
            'Package archive extraction failed. The package may be corrupted.': '安装包解压失败，安装包可能已损坏。',
            'Checksum verification failed. The package may be corrupted or tampered with.': '校验和验证失败，安装包可能已损坏或被篡改。',
            'Signature verification failed. The package may be tampered with or from an untrusted source.': '签名验证失败，安装包可能被篡改或来自不受信任的来源。',
            'Network error occurred while downloading the scenario package.': '下载场景包时发生网络错误。',
            'File size mismatch': '文件大小不匹配',
            'No download URL returned from server': '服务器未返回下载地址',
            'Not authenticated. Please log in first.': '未登录，请先登录。',
        }
        for (const [en, zh] of Object.entries(map)) {
            if (error.includes(en) || error.startsWith(en)) return zh
        }
        return error
    }

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

    const [rollbackInfo, setRollbackInfo] = useState<{
        available: boolean
        previousVersion: string
        backedUpAt: string
    } | null>(null)
    const [isRollingBack, setIsRollingBack] = useState(false)

    useEffect(() => {
        if (!isAuthenticated) return
        const doCheck = async () => {
            try {
                const installed = scenarioRegistry.getInstalled()
                const checkList = installed.map(s => ({ id: s.id, version: s.version || '1.0.0' }))
                if (checkList.length === 0) return
                const results = await checkScenarioUpdates(checkList)
                const map = new Map<string, MarketplaceUpdateInfo>()
                results.forEach(r => map.set(r.scenarioId, r))
                setScenarioUpdates(map)
            } catch { /* ignore */ }
        }
        doCheck()
        const timer = setInterval(doCheck, 30 * 60 * 1000)
        return () => clearInterval(timer)
    }, [isAuthenticated])

    const handleUpdateScenario = useCallback(async (scenarioId: string) => {
        const updateInfo = scenarioUpdates.get(scenarioId)
        if (!updateInfo) return
        setUpdatingScenarioId(scenarioId)
        try {
            const result = await updateScenarioFromMarketplace(scenarioId, updateInfo.latestVersion)
            if (result.success) {
                toast.success(language === 'zh' ? `场景已更新至 v${result.version}` : `Scenario updated to v${result.version}`)
                setScenarioUpdates(prev => {
                    const next = new Map(prev)
                    next.delete(scenarioId)
                    return next
                })
            } else {
                const errorMsg = translateInstallError(result.error || (language === 'zh' ? '未知错误' : 'Unknown error'))
                toast.card({
                    type: 'error',
                    title: language === 'zh' ? '更新失败' : 'Update Failed',
                    message: errorMsg,
                    duration: 5000,
                    source: 'ScenarioMarketplace',
                })
            }
        } catch (err) {
            const errorMsg = translateInstallError(err instanceof Error ? err.message : String(err))
            toast.card({
                type: 'error',
                title: language === 'zh' ? '更新失败' : 'Update Failed',
                message: errorMsg,
                duration: 5000,
                source: 'ScenarioMarketplace',
            })
        } finally {
            setUpdatingScenarioId(null)
        }
    }, [scenarioUpdates, language])

    const scenarios = scenarioRegistry.getInstalled()
    const builtinScenarios = scenarios.filter(s => s.isBuiltin).sort((a, b) => {
        if (a.id === 'general-assistant') return -1
        if (b.id === 'general-assistant') return 1
        return 0
    })
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
        activateScenarioPanels(scenario)
        switchToFirstPanel(scenario)
    }, [])

    const handleOpenDetail = useCallback(async (scenarioId: string) => {
        setDetailScenarioId(scenarioId)
        setIsLoadingHealth(true)
        setHealthReport(null)
        setRollbackInfo(null)
        try {
            const report = await scenarioLoader.healthCheck(scenarioId)
            setHealthReport(report)
        } catch {
            setHealthReport(null)
        } finally {
            setIsLoadingHealth(false)
        }
        try {
            const info = await api.scenarioRollback.getInfo(scenarioId)
            if (info.available) {
                setRollbackInfo({
                    available: true,
                    previousVersion: info.previousVersion || '',
                    backedUpAt: info.backedUpAt || '',
                })
            }
        } catch {}
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
            const scenario = scenarioRegistry.get(uninstallState.scenarioId)
            const isBuiltin = scenario?.isBuiltin ?? false

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
            } catch {}

            if (isBuiltin) {
                try {
                    await api.scenarioInstall.deleteBuiltinSourceDir(uninstallState.scenarioId)
                } catch {}
            }
        } catch (err) {
            console.error('[ScenarioManager] Uninstall failed:', err)
        } finally {
            setUninstallState(null)
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

            try {
                const filesResult = await api.scenarioInstall.loadScenarioFiles(scenarioId)
                if (filesResult.success) {
                    const declarativeModule = new DeclarativeScenarioModule(
                        config as any,
                        filesResult.files,
                    )
                    scenarioLoader.register(declarativeModule)
                }
            } catch (moduleErr) {
                console.warn('[ScenarioInstall] Failed to register DeclarativeScenarioModule:', moduleErr)
            }

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

    const handleRollback = useCallback(async (scenarioId: string) => {
        setIsRollingBack(true)
        try {
            const result = await api.scenarioRollback.rollback(scenarioId)
            if (result.success) {
                const scenario = scenarioRegistry.get(scenarioId)
                if (scenario && result.version) {
                    scenarioRegistry.updateScenario(scenarioId, { version: result.version })
                }
                setRollbackInfo(null)
                toast.success(
                    language === 'zh' ? '回滚成功' : 'Rollback Successful',
                    language === 'zh'
                        ? `场景已回滚至 v${result.version}`
                        : `Scenario rolled back to v${result.version}`
                )
            } else {
                toast.error(
                    language === 'zh' ? '回滚失败' : 'Rollback Failed',
                    result.error || ''
                )
            }
        } catch (err) {
            toast.error(
                language === 'zh' ? '回滚失败' : 'Rollback Failed',
                err instanceof Error ? err.message : ''
            )
        } finally {
            setIsRollingBack(false)
        }
    }, [language])

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
        const sourceInfo = SOURCE_LABELS[scenario.source || (isBuiltin ? 'builtin' : 'local')]
        const SourceIcon = sourceInfo?.icon || Package
        const showSettings = scenario.hasSettings === true
        const updateInfo = scenarioUpdates.get(scenario.id)
        const isUpdating = updatingScenarioId === scenario.id

        return (
            <div
                key={scenario.id}
                className={`
                    rounded-xl border transition-all duration-200 overflow-hidden shadow-sm
                    ${isActive
                        ? 'border-accent/30 bg-accent/[0.06] shadow-accent/5'
                        : 'border-border/20 bg-surface/20 hover:bg-surface/40 hover:border-border/40 shadow-black/5'}
                `}
            >
                <div className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-accent/15' : 'bg-surface/60'}`}>
                            <IconComponent className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-text-primary truncate">
                                    {language === 'zh' ? scenario.nameZh : scenario.name}
                                </span>
                                {isActive && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                                        <Check className="w-2.5 h-2.5" />
                                        {language === 'zh' ? '使用中' : 'Active'}
                                    </span>
                                )}
                                {isBuiltin && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">
                                        <Shield className="w-2.5 h-2.5" />
                                        {language === 'zh' ? '内置' : 'Built-in'}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted">
                                <span className={`flex items-center gap-0.5 ${catLabel.color}`}>
                                    {language === 'zh' ? catLabel.zh : catLabel.en}
                                </span>
                                <span>·</span>
                                <span>v{scenario.version}</span>
                                <span>·</span>
                                <SourceIcon className="w-3 h-3" />
                                <span>{language === 'zh' ? sourceInfo?.zh : sourceInfo?.en}</span>
                            </div>
                        </div>
                    </div>

                    <p className="text-[12px] text-text-muted/80 mt-2 line-clamp-2 leading-relaxed">
                        {language === 'zh' ? scenario.descriptionZh : scenario.description}
                    </p>

                    {updateInfo && (
                        <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/15">
                            <ArrowUpCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span className="text-[11px] text-blue-400 font-medium">
                                {language === 'zh' ? `新版本 v${updateInfo.latestVersion} 可更新` : `v${updateInfo.latestVersion} available`}
                            </span>
                            {isUpdating ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 ml-auto" />
                            ) : (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleUpdateScenario(scenario.id) }}
                                    className="ml-auto text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors font-medium"
                                >
                                    {language === 'zh' ? '更新' : 'Update'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                        {!isActive && (
                            <ActionButton
                                variant="primary"
                                size="sm"
                                className="h-7 text-[12px] gap-1.5 px-3 rounded-lg"
                                onClick={(e) => { e.stopPropagation(); handleSwitch(scenario) }}
                            >
                                <Check className="w-3 h-3" />
                                {language === 'zh' ? '切换' : 'Switch'}
                            </ActionButton>
                        )}
                        {showSettings && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[12px] gap-1.5 px-3 rounded-lg"
                                onClick={(e) => { e.stopPropagation(); handleOpenSettings(scenario.id) }}
                            >
                                <Settings className="w-3 h-3" />
                                {language === 'zh' ? '设置' : 'Settings'}
                            </ActionButton>
                        )}
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[12px] gap-1.5 px-3 rounded-lg"
                            onClick={(e) => { e.stopPropagation(); handleOpenDetail(scenario.id) }}
                        >
                            <Info className="w-3 h-3" />
                            {language === 'zh' ? '详情' : 'Details'}
                        </ActionButton>
                        {!isBuiltin && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[12px] gap-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-400/10 ml-auto"
                                onClick={(e) => { e.stopPropagation(); handleRequestUninstall(scenario) }}
                            >
                                <PackageX className="w-3 h-3" />
                                {language === 'zh' ? '卸载' : 'Uninstall'}
                            </ActionButton>
                        )}
                        {isBuiltin && !scenario.isDefault && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[12px] gap-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-400/10 ml-auto"
                                onClick={(e) => { e.stopPropagation(); handleRequestUninstall(scenario) }}
                            >
                                <PackageX className="w-3 h-3" />
                                {language === 'zh' ? '卸载' : 'Uninstall'}
                            </ActionButton>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/20 bg-background/80 backdrop-blur-sm">
                <div className="flex items-center gap-6">
                    <h1 className="text-base font-bold text-text-primary">
                        {language === 'zh' ? '场景管理' : 'Scenario Manager'}
                    </h1>
                    <div className="flex items-center bg-surface/40 rounded-lg p-0.5 border border-border/20">
                        <button
                            onClick={() => setActiveTab('installed')}
                            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                                activeTab === 'installed'
                                    ? 'bg-background text-text-primary shadow-sm border border-border/30'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <Package className="w-3.5 h-3.5" />
                                {language === 'zh' ? '已安装' : 'Installed'}
                                <span className="text-[10px] opacity-60">({scenarios.length})</span>
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('marketplace')}
                            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                                activeTab === 'marketplace'
                                    ? 'bg-background text-text-primary shadow-sm border border-border/30'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <Globe className="w-3.5 h-3.5" />
                                {language === 'zh' ? '场景市场' : 'Marketplace'}
                            </span>
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {activeTab === 'installed' && (
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 px-3 rounded-lg border border-dashed border-border/30 hover:border-accent/30 hover:text-accent"
                            onClick={handleInstallScenario}
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            {language === 'zh' ? '本地安装' : 'Local Install'}
                        </ActionButton>
                    )}
                    <button
                        onClick={() => setActiveSidePanel(null)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface/60 transition-colors"
                        title={language === 'zh' ? '关闭' : 'Close'}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                {activeTab === 'installed' ? (
                    <InstalledTab
                        language={language}
                        scenarios={scenarios}
                        filteredBuiltin={filteredBuiltin}
                        filteredInstalled={filteredInstalled}
                        filterCategory={filterCategory}
                        setFilterCategory={setFilterCategory}
                        sortedCategories={sortedCategories}
                        renderScenarioCard={renderScenarioCard}
                    />
                ) : (
                    <MarketplaceTab language={language} isAuthenticated={isAuthenticated} />
                )}
            </div>

            {installState.phase !== 'idle' && (
                <OverlayDialog
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
                                <ActionButton variant="ghost" size="sm" onClick={handleCloseInstall}>
                                    {language === 'zh' ? '取消' : 'Cancel'}
                                </ActionButton>
                                <ActionButton variant="primary" size="sm" onClick={handleConfirmInstall}>
                                    {language === 'zh' ? '确认安装' : 'Install'}
                                </ActionButton>
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
                            <ActionButton variant="primary" size="sm" onClick={handleCloseInstall}>
                                {language === 'zh' ? '完成' : 'Done'}
                            </ActionButton>
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
                            <ActionButton variant="primary" size="sm" onClick={handleCloseInstall}>
                                {language === 'zh' ? '关闭' : 'Close'}
                            </ActionButton>
                        </div>
                    )}
                </OverlayDialog>
            )}

            <DecisionOverlay
                isOpen={uninstallState?.isConfirming === true}
                title={language === 'zh' ? '确认卸载' : 'Confirm Uninstall'}
                message={language === 'zh'
                    ? `确定要卸载场景「${uninstallState?.scenarioName}」吗？卸载将删除场景文件、数据库及所有相关数据，此操作不可恢复。`
                    : `Are you sure you want to uninstall "${uninstallState?.scenarioName}"? This will remove scenario files, database, and all related data. This action cannot be undone.`
                }
                confirmText={language === 'zh' ? '确认卸载' : 'Uninstall'}
                cancelText={language === 'zh' ? '取消' : 'Cancel'}
                severity="danger"
                riskTag={language === 'zh' ? '不可恢复' : 'Irreversible'}
                auditAction="scenario-uninstall"
                onConfirm={handleConfirmUninstall}
                onCancel={handleCancelUninstall}
            />

            {uninstallState?.isUninstalling && (
                <OverlayDialog isOpen onClose={() => {}} showCloseButton={false} size="sm">
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
                </OverlayDialog>
            )}

            <OverlayDialog
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

                        {rollbackInfo?.available && (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="text-[12px] font-medium text-amber-400 flex items-center gap-1.5">
                                            <AlertTriangle className="w-3.5 h-3.5" />
                                            {language === 'zh' ? '可回滚版本' : 'Rollback Available'}
                                        </h4>
                                        <p className="text-[11px] text-text-muted mt-1">
                                            {language === 'zh'
                                                ? `可回滚至 v${rollbackInfo.previousVersion}（备份于 ${new Date(rollbackInfo.backedUpAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}）`
                                                : `Roll back to v${rollbackInfo.previousVersion} (backed up ${new Date(rollbackInfo.backedUpAt).toLocaleString('en-US')})`
                                            }
                                        </p>
                                    </div>
                                    <ActionButton
                                        variant="secondary"
                                        size="sm"
                                        className="h-7 text-[11px] gap-1.5 px-3 rounded-lg border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                        onClick={() => handleRollback(detailScenarioId!)}
                                        disabled={isRollingBack}
                                    >
                                        {isRollingBack ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <RotateCcw className="w-3 h-3" />
                                        )}
                                        {language === 'zh' ? '回滚' : 'Rollback'}
                                    </ActionButton>
                                </div>
                            </div>
                        )}

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
                                    onClick={(e) => { e.preventDefault(); api.file.openExternalUrl(detailManifest.homepage!) }}
                                >
                                    <Globe className="w-3 h-3" />
                                    {language === 'zh' ? '主页' : 'Homepage'}
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </OverlayDialog>

            <OverlayDialog
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
            </OverlayDialog>
        </div>
    )
}

function InstalledTab({
    language,
    scenarios,
    filteredBuiltin,
    filteredInstalled,
    filterCategory,
    setFilterCategory,
    sortedCategories,
    renderScenarioCard,
}: {
    language: string
    scenarios: ScenarioPlugin[]
    filteredBuiltin: ScenarioPlugin[]
    filteredInstalled: ScenarioPlugin[]
    filterCategory: string | null
    setFilterCategory: (cat: string | null) => void
    sortedCategories: string[]
    renderScenarioCard: (scenario: ScenarioPlugin) => React.ReactNode
}) {
    return (
        <div className="h-full overflow-y-auto p-6">
            {sortedCategories.length > 1 && (
                <div className="flex items-center gap-1.5 mb-5 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setFilterCategory(null)}
                        className={`text-[11px] px-3 py-1.5 rounded-lg whitespace-nowrap transition-all font-medium ${
                            !filterCategory
                                ? 'bg-accent/15 text-accent border border-accent/30'
                                : 'text-text-muted hover:text-text-primary border border-border/20 hover:border-border/40'
                        }`}
                    >
                        {language === 'zh' ? '全部' : 'All'}
                    </button>
                    {sortedCategories.map(cat => {
                        const catLabel = CATEGORY_LABELS[cat] || CATEGORY_LABELS.custom
                        return (
                            <button
                                key={cat}
                                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                                className={`text-[11px] px-3 py-1.5 rounded-lg whitespace-nowrap transition-all font-medium ${
                                    filterCategory === cat
                                        ? 'bg-accent/15 text-accent border border-accent/30'
                                        : `${catLabel.color} hover:opacity-80 border border-border/20 hover:border-border/40`
                                }`}
                            >
                                {language === 'zh' ? catLabel.zh : catLabel.en}
                            </button>
                        )
                    })}
                </div>
            )}

            {filteredBuiltin.length > 0 && (
                <div className="mb-6">
                    <div className="flex items-center gap-1.5 mb-3">
                        <Shield className="w-3.5 h-3.5 text-amber-400/60" strokeWidth={1.5} />
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '内置场景' : 'Built-in'}
                        </span>
                        <span className="text-[10px] text-text-muted/60">({filteredBuiltin.length})</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredBuiltin.map(renderScenarioCard)}
                    </div>
                </div>
            )}

            {filteredInstalled.length > 0 && (
                <div className="mb-6">
                    <div className="flex items-center gap-1.5 mb-3">
                        <Package className="w-3.5 h-3.5 text-accent/60" strokeWidth={1.5} />
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '已安装场景' : 'Installed'}
                        </span>
                        <span className="text-[10px] text-text-muted/60">({filteredInstalled.length})</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredInstalled.map(renderScenarioCard)}
                    </div>
                </div>
            )}

            {scenarios.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Package className="w-12 h-12 text-text-muted/20 mb-4" strokeWidth={1} />
                    <p className="text-sm text-text-muted/60">
                        {language === 'zh' ? '暂无已安装的场景' : 'No scenarios installed'}
                    </p>
                    <p className="text-xs text-text-muted/40 mt-1">
                        {language === 'zh' ? '从场景市场安装场景，或点击「本地安装」从本地目录安装' : 'Install from marketplace or click "Local Install" to install from a local directory'}
                    </p>
                </div>
            )}
        </div>
    )
}

function MarketplaceTab({ language, isAuthenticated }: { language: string; isAuthenticated: boolean }) {
    const [items, setItems] = useState<MarketplaceScenario[]>([])
    const [featured, setFeatured] = useState<MarketplaceScenario[]>([])
    const [categories, setCategories] = useState<MarketplaceCategory[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [selectedItem, setSelectedItem] = useState<MarketplaceScenario | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [installing, setInstalling] = useState<string | null>(null)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [permissionPending, setPermissionPending] = useState<MarketplaceScenario | null>(null)
    const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])

    function translateInstallError(error: string): string {
        if (language !== 'zh') return error
        const map: Record<string, string> = {
            'Package archive is corrupted or in an unsupported format. Please verify the scenario package.': '安装包已损坏或格式不受支持，请检查场景包是否正确。',
            'Package archive is corrupted or contains invalid entries. Please verify the scenario package.': '安装包已损坏或包含无效内容，请检查场景包是否正确。',
            'Package archive extraction failed. The package may be corrupted.': '安装包解压失败，安装包可能已损坏。',
            'Checksum verification failed. The package may be corrupted or tampered with.': '校验和验证失败，安装包可能已损坏或被篡改。',
            'Signature verification failed. The package may be tampered with or from an untrusted source.': '签名验证失败，安装包可能被篡改或来自不受信任的来源。',
            'Network error occurred while downloading the scenario package.': '下载场景包时发生网络错误。',
            'File size mismatch': '文件大小不匹配',
            'No download URL returned from server': '服务器未返回下载地址',
            'Not authenticated. Please log in first.': '未登录，请先登录。',
        }
        for (const [en, zh] of Object.entries(map)) {
            if (error.includes(en) || error.startsWith(en)) return zh
        }
        return error
    }

    useEffect(() => {
        loadFeatured()
        loadCategories()
    }, [isAuthenticated])

    useEffect(() => {
        loadItems()
    }, [searchQuery, selectedCategory, page, isAuthenticated])

    async function loadItems() {
        setIsLoading(true)
        try {
            const result = await browseScenarios({
                category: selectedCategory || undefined,
                search: searchQuery || undefined,
                page,
                limit: 20,
            })
            setItems(result.scenarios)
            setTotal(result.total)
        } catch {
            setItems([])
            setTotal(0)
        } finally {
            setIsLoading(false)
        }
    }

    async function loadFeatured() {
        try {
            const result = await getFeaturedScenarios()
            setFeatured(result)
        } catch {
            setFeatured([])
        }
    }

    async function loadCategories() {
        try {
            const result = await getMarketplaceCategories()
            setCategories(result)
        } catch {
            setCategories([])
        }
    }

    async function handleInstall(item: MarketplaceScenario) {
        if (item.permissions && item.permissions.length > 0) {
            setPermissionPending(item)
            return
        }
        await doInstall(item)
    }

    async function doInstall(item: MarketplaceScenario) {
        setInstalling(item.id)
        try {
            const result = await installScenarioFromMarketplace(item.id, item.version)
            if (result.success) {
                toast.success(
                    language === 'zh' ? `场景 "${item.nameZh}" 安装成功` : `Scenario "${item.name}" installed successfully`,
                )
                setSelectedItem(null)
                await loadItems()
            } else if (result.requiresPayment) {
                toast.card({
                    type: 'warning',
                    title: language === 'zh' ? '付费场景' : 'Paid Scenario',
                    message: language === 'zh'
                        ? `该场景为付费场景，价格: ¥${result.price}，暂不支持在线支付`
                        : `This is a paid scenario (¥${result.price}). Online payment is not yet supported.`,
                    duration: 5000,
                    source: 'ScenarioMarketplace',
                })
            } else {
                const errorMsg = translateInstallError(result.error || (language === 'zh' ? '未知错误' : 'Unknown error'))
                toast.card({
                    type: 'error',
                    title: language === 'zh' ? '安装失败' : 'Install Failed',
                    message: errorMsg,
                    duration: 5000,
                    source: 'ScenarioMarketplace',
                })
            }
        } catch (err) {
            const errorMsg = translateInstallError(err instanceof Error ? err.message : String(err))
            toast.card({
                type: 'error',
                title: language === 'zh' ? '安装失败' : 'Install Failed',
                message: errorMsg,
                duration: 5000,
                source: 'ScenarioMarketplace',
            })
        } finally {
            setInstalling(null)
        }
    }

    function renderStars(rating: number) {
        const stars = []
        for (let i = 1; i <= 5; i++) {
            stars.push(
                <Star
                    key={i}
                    className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-border/40'}`}
                />
            )
        }
        return <div className="flex items-center gap-0.5">{stars}</div>
    }

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                <Globe className="w-12 h-12 text-text-muted/30 mb-4" strokeWidth={1} />
                <p className="text-sm text-text-muted mb-1">{t('请先登录', 'Please log in first')}</p>
                <p className="text-xs text-text-muted/60">{t('登录后可浏览和安装在线场景', 'Log in to browse and install online scenarios')}</p>
            </div>
        )
    }

    if (selectedItem) {
        return (
            <div className="h-full overflow-auto p-6">
                <button
                    onClick={() => setSelectedItem(null)}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-4 transition-colors"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {t('返回列表', 'Back to list')}
                </button>

                <div className="max-w-3xl mx-auto">
                    <div className="flex items-start gap-4 mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                            {CATEGORY_ICONS[selectedItem.category] || <Package className="w-7 h-7" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-text-primary">
                                {language === 'zh' ? selectedItem.nameZh : selectedItem.name}
                            </h2>
                            <p className="text-sm text-text-secondary mt-1">
                                {language === 'zh' ? selectedItem.descriptionZh : selectedItem.description}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-6">
                        <div className="text-center p-3 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
                            <div className="text-lg font-bold text-text-primary">{selectedItem.rating.toFixed(1)}</div>
                            <div className="text-[11px] text-text-muted mt-0.5">{t('评分', 'Rating')}</div>
                            <div className="flex items-center justify-center mt-1">{renderStars(selectedItem.rating)}</div>
                        </div>
                        <div className="text-center p-3 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
                            <div className="text-lg font-bold text-text-primary">{selectedItem.downloads}</div>
                            <div className="text-[11px] text-text-muted mt-0.5">{t('下载', 'Downloads')}</div>
                        </div>
                        <div className="text-center p-3 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
                            <div className="text-lg font-bold text-text-primary">v{selectedItem.version}</div>
                            <div className="text-[11px] text-text-muted mt-0.5">{t('版本', 'Version')}</div>
                        </div>
                    </div>

                    {selectedItem.tags?.length > 0 && (
                        <div className="mb-6">
                            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{t('标签', 'Tags')}</h4>
                            <div className="flex flex-wrap gap-1.5">
                                {selectedItem.tags.map(tag => (
                                    <span key={tag} className="px-2 py-0.5 text-[11px] rounded-md bg-surface/40 text-text-secondary border border-border/15 flex items-center gap-1">
                                        <Tag className="w-2.5 h-2.5" />
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {selectedItem.minAppVersion && (
                        <div className="text-[12px] text-text-muted mb-4">
                            {t(`最低应用版本: ${selectedItem.minAppVersion}`, `Min App Version: ${selectedItem.minAppVersion}`)}
                        </div>
                    )}

                    <div className="flex items-center gap-2 text-[12px] text-text-muted mb-6">
                        <Shield className="w-3.5 h-3.5 text-green-400" />
                        <span>{t('安全审查已通过', 'Security review passed')}</span>
                    </div>

                    <div className="flex items-center gap-3 mb-8">
                        <ActionButton
                            className="h-10 text-sm gap-2 px-6 rounded-xl"
                            onClick={() => handleInstall(selectedItem)}
                            disabled={installing === selectedItem.id}
                        >
                            {installing === selectedItem.id ? (
                                <>
                                    <Clock className="w-4 h-4 animate-spin" />
                                    {t('安装中...', 'Installing...')}
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    {t('安装场景', 'Install Scenario')}
                                </>
                            )}
                        </ActionButton>
                    </div>

                    <ScenarioReviewPanel
                        scenarioId={selectedItem.id}
                        scenarioName={selectedItem.name}
                        scenarioNameZh={selectedItem.nameZh}
                        currentRating={selectedItem.rating}
                        ratingCount={selectedItem.ratingCount}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-3 border-b border-border/10">
                <div className="flex items-center gap-3 mb-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                            placeholder={t('搜索场景...', 'Search scenarios...')}
                            className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface/30 border border-border/15 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/30 transition-colors"
                        />
                    </div>
                    <button
                        onClick={() => { loadItems(); loadFeatured(); loadCategories(); }}
                        className="p-2 rounded-lg hover:bg-surface/40 text-text-muted hover:text-text-primary transition-colors"
                        title={t('刷新', 'Refresh')}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => { setSelectedCategory(null); setPage(1) }}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                            !selectedCategory
                                ? 'bg-accent/15 text-accent border border-accent/30'
                                : 'text-text-muted hover:text-text-secondary border border-border/20'
                        }`}
                    >
                        {t('全部', 'All')}
                    </button>
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => { setSelectedCategory(cat.id === selectedCategory ? null : cat.id); setPage(1) }}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                                cat.id === selectedCategory
                                    ? 'bg-accent/15 text-accent border border-accent/30'
                                    : 'text-text-muted hover:text-text-secondary border border-border/20'
                            }`}
                        >
                            {CATEGORY_ICONS[cat.id]}
                            <span>{cat.nameZh && language === 'zh' ? cat.nameZh : cat.name}</span>
                            <span className="opacity-60">{cat.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
                {featured.length > 0 && !searchQuery && !selectedCategory && (
                    <div className="mb-8">
                        <h3 className="text-sm font-semibold text-text-primary mb-3">{t('✨ 精选推荐', '✨ Featured')}</h3>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {featured.slice(0, 8).map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setSelectedItem(item)}
                                    className="p-3 rounded-xl border border-border/20 bg-surface/20 hover:bg-surface/40 hover:border-border/40 shadow-sm shadow-black/5 text-left transition-all group"
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                                            {CATEGORY_ICONS[item.category] || <Package className="w-4 h-4" />}
                                        </div>
                                        <span className="text-[12px] font-medium text-text-primary truncate">
                                            {language === 'zh' ? item.nameZh : item.name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {renderStars(item.rating)}
                                        <span className="text-[10px] text-text-muted">({item.downloads} {t('下载', 'dl')})</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-text-primary">
                            {searchQuery || selectedCategory
                                ? t('搜索结果', 'Search Results')
                                : t('所有场景', 'All Scenarios')}
                            {total > 0 && <span className="ml-1.5 text-text-muted font-normal text-xs">({total})</span>}
                        </h3>
                        {isLoading && <Loader2 className="w-4 h-4 text-text-muted animate-spin" />}
                    </div>

                    {items.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
                            <Package className="w-10 h-10 mb-3 opacity-30" strokeWidth={1} />
                            <p className="text-sm">{t('暂无场景', 'No scenarios found')}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {items.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setSelectedItem(item)}
                                className="w-full p-4 rounded-xl border border-border/20 bg-surface/20 hover:bg-surface/40 hover:border-border/40 shadow-sm shadow-black/5 text-left transition-all group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-accent/8 flex items-center justify-center text-accent flex-shrink-0">
                                        {CATEGORY_ICONS[item.category] || <Package className="w-5 h-5" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[13px] font-medium text-text-primary truncate">
                                                {language === 'zh' ? item.nameZh : item.name}
                                            </span>
                                            {item.isFree && (
                                                <span className="px-1.5 py-0.5 text-[9px] rounded-md bg-green-500/10 text-green-400 font-semibold flex-shrink-0">
                                                    {t('免费', 'FREE')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            {renderStars(item.rating)}
                                            <span className="text-[10px] text-text-muted">{item.downloads} {t('下载', 'dl')}</span>
                                        </div>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-text-muted/30 group-hover:text-text-muted/60 flex-shrink-0" />
                                </div>
                                <p className="text-[11px] text-text-muted/70 mt-2 line-clamp-2 leading-relaxed">
                                    {language === 'zh' ? item.descriptionZh : item.description}
                                </p>
                            </button>
                        ))}
                    </div>

                    {total > 20 && (
                        <div className="flex items-center justify-center gap-3 mt-6">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="px-3 py-1.5 text-[11px] rounded-lg bg-surface/30 text-text-muted disabled:opacity-40 hover:bg-surface/50 transition-colors"
                            >
                                {t('上一页', 'Prev')}
                            </button>
                            <span className="text-[11px] text-text-muted">{page} / {Math.ceil(total / 20)}</span>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={page * 20 >= total}
                                className="px-3 py-1.5 text-[11px] rounded-lg bg-surface/30 text-text-muted disabled:opacity-40 hover:bg-surface/50 transition-colors"
                            >
                                {t('下一页', 'Next')}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {permissionPending && (
                <PermissionConfirmDialog
                    scenarioName={permissionPending.name}
                    scenarioNameZh={permissionPending.nameZh}
                    permissions={permissionPending.permissions || []}
                    onConfirm={() => {
                        const item = permissionPending
                        setPermissionPending(null)
                        doInstall(item)
                    }}
                    onCancel={() => setPermissionPending(null)}
                />
            )}
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
