import { useState, useCallback, useEffect, Suspense } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
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
    ArrowUpCircle,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core/ScenarioLoader'
import { scenarioDatabaseManager } from '@scenario-system/core/ScenarioDatabaseManager'
import { api } from '../../adapters/electronBridge'
import { ActionButton, OverlayDialog } from '../ui'
import DecisionOverlay from '@components/foundation/DecisionOverlay'
import { PermissionConfirmDialog } from './PermissionConfirmDialog'
import { ScenarioReviewPanel } from './ScenarioReviewPanel'
import { ScenePromptConfigDialog } from './ScenePromptConfigDialog'
import type { ScenarioPlugin, UILayout } from '@shared/protocols/scenario'
import { activateScenarioPanels, switchToFirstPanel } from './panelUtils'
import { registerInstalledScenario } from './scenarioInstallUtils'
import type { ScenarioHealthReport } from '@shared/protocols/scenario-arch'
import type { LucideIcon } from 'lucide-react'
import {
    browseScenarios,
    getFeaturedScenarios,
    getMarketplaceCategories,
    installScenarioFromMarketplace,
    createScenarioOrder,
    checkScenarioUpdates,
    updateScenarioFromMarketplace,
} from '@services/marketplaceService'
import { PaymentDialog } from '@components/payment/PaymentDialog'
import type {
    MarketplaceScenario,
    MarketplaceCategory,
    MarketplaceUpdateInfo,
} from '@scenario-system/marketplace'
import { toast } from '../foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

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

export function ScenarioManagerView() {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const isAuthenticated = useStore(s => s.isAuthenticated)
    const setShowScenarioPage = useStore(s => s.setShowScenarioPage)
    const activeTab = useStore(s => s.scenarioPageTab)
    const setActiveTab = useStore(s => s.setScenarioPageTab)
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
    /** 场景级 Prompt 配置弹窗目标场景 ID */
    const [promptConfigScenarioId, setPromptConfigScenarioId] = useState<string | null>(null)
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
                toast.success(t('scenario.scenarioupdatedtov', language as Language, { version: result.version }))
                setScenarioUpdates(prev => {
                    const next = new Map(prev)
                    next.delete(scenarioId)
                    return next
                })
            } else {
                const errorMsg = translateInstallError(result.error || (t('scenario.unknownerror', language as Language)))
                toast.card({
                    type: 'error',
                    title: t('scenario.updatefailed', language as Language),
                    message: errorMsg,
                    duration: 5000,
                    source: 'ScenarioMarketplace',
                })
            }
        } catch (err) {
            const errorMsg = translateInstallError(err instanceof Error ? err.message : String(err))
            toast.card({
                type: 'error',
                title: t('scenario.updatefailed2', language as Language),
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
        // 持久化场景选择，确保应用重启后自动进入上次使用的场景
        void useStore.getState().save()
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
        } catch (e) { logger.scenario.warn('Failed to load scenario updates:', e) }
    }, [])

    const handleOpenSettings = useCallback((scenarioId: string) => {
        setSettingsScenarioId(scenarioId)
    }, [])

    /** 打开场景级 Prompt 配置弹窗 */
    const handleOpenPromptConfig = useCallback((scenarioId: string) => {
        setPromptConfigScenarioId(scenarioId)
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

            // 卸载后同步当前 activeScenarioId（若卸载的是当前场景，registry 已回退到默认）
            const activeId = scenarioRegistry.getActiveId()
            if (activeId && activeId !== useStore.getState().activeScenarioId) {
                useStore.getState().set('activeScenarioId', activeId)
                void useStore.getState().save()
            }

            // 清理场景专属数据库
            try {
                let uninstallScripts: Array<{ id: string; description?: string; sql: string }> = []
                // 尝试从场景文件中读取卸载脚本
                try {
                    const filesResult = await api.scenarioInstall.loadScenarioFiles(uninstallState.scenarioId)
                    if (filesResult.success && filesResult.config) {
                        const cfg = filesResult.config as Record<string, unknown>
                        uninstallScripts = (cfg.uninstallScripts || []) as Array<{ id: string; description?: string; sql: string }>
                    }
                } catch { /* 场景文件可能已不存在 */ }
                await scenarioDatabaseManager.drop(uninstallState.scenarioId, uninstallScripts)
            } catch (e) { logger.scenario.warn('Failed to drop scenario database:', e) }

            try {
                await api.scenarioInstall.deleteScenarioDir(uninstallState.scenarioId)
            } catch (e) { logger.scenario.warn('Failed to delete scenario dir:', e) }

            if (isBuiltin) {
                try {
                    await api.scenarioInstall.deleteBuiltinSourceDir(uninstallState.scenarioId)
                } catch (e) { logger.scenario.warn('Failed to delete builtin source dir:', e) }
            }
        } catch (err) {
            logger.scenario.error('[ScenarioManager] Uninstall failed:', err)
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
                    error: t('scenario.scenarioisalreadyinstalledplease', language as Language, { name: String(config.name), nameZh: String(config.nameZh || config.name) }),
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

            await registerInstalledScenario(config as any, {
                scenarioId,
                source: 'local',
                version: (config.version as string) || '1.0.0',
            })

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
                    t('scenario.rollbacksuccessful', language as Language),
                    t('scenario.scenariorolledbacktov', language as Language, { version: result.version })
                )
            } else {
                toast.error(
                    t('scenario.rollbackfailed', language as Language),
                    result.error || ''
                )
            }
        } catch (err) {
            toast.error(
                t('scenario.rollbackfailed2', language as Language),
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
                    rounded-2xl border transition-all duration-200 overflow-hidden shadow-sm
                    ${isActive
                        ? 'border-accent/30 bg-accent/[0.06] shadow-accent/5'
                        : 'border-border/15 bg-surface/20 hover:bg-surface/40 hover:border-border/30 shadow-black/5'}
                `}
            >
                <div className="p-5">
                    <div className="flex items-start gap-4">
                        {scenario.icon ? (
                            isImageIcon(scenario.icon) ? (
                                <img src={scenario.icon} alt="" className="w-12 h-12 flex-shrink-0 rounded-xl object-cover bg-background/50" />
                            ) : (
                                <IconComponent className={`w-12 h-12 flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                            )
                        ) : (
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors overflow-hidden ${isActive ? 'bg-accent/15' : 'bg-surface/60'}`}>
                                <IconComponent className={`w-6 h-6 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                            </div>
                        )}
                        <div className="flex-1 min-w-0 pt-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base font-semibold text-text-primary truncate">
                                    {language === 'zh' ? scenario.nameZh : scenario.name}
                                </span>
                                {isActive && (
                                    <span className="flex items-center gap-0.5 text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-lg">
                                        <Check className="w-2.5 h-2.5" />
                                        {t('scenario.active', language as Language)}
                                    </span>
                                )}
                                {isBuiltin && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-lg">
                                        <Shield className="w-3 h-3" />
                                        {t('scenario.builtin', language as Language)}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
                                <span className={`flex items-center gap-0.5 ${catLabel.color}`}>
                                    {language === 'zh' ? catLabel.zh : catLabel.en}
                                </span>
                                <span>·</span>
                                <span>v{scenario.version}</span>
                                <span>·</span>
                                <SourceIcon className="w-3.5 h-3.5" />
                                <span>{language === 'zh' ? sourceInfo?.zh : sourceInfo?.en}</span>
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-text-muted/80 mt-4 line-clamp-2 leading-relaxed">
                        {language === 'zh' ? scenario.descriptionZh : scenario.description}
                    </p>

                    {updateInfo && (
                        <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl bg-blue-500/5 border border-blue-500/15">
                            <ArrowUpCircle className="w-4 h-4 text-blue-400 shrink-0" />
                            <span className="text-xs text-blue-400 font-medium">
                                {t('scenario.vavailable', language as Language, { latestVersion: updateInfo.latestVersion })}
                            </span>
                            {isUpdating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-blue-400 ml-auto" />
                            ) : (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleUpdateScenario(scenario.id) }}
                                    className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors font-medium"
                                >
                                    {t('scenario.update', language as Language)}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border/10">
                        {!isActive && (
                            <ActionButton
                                variant="primary"
                                size="sm"
                                className="h-8 text-xs gap-1.5 px-4 rounded-xl"
                                onClick={(e) => { e.stopPropagation(); handleSwitch(scenario) }}
                            >
                                <Check className="w-3.5 h-3.5" />
                                {t('scenario.switch', language as Language)}
                            </ActionButton>
                        )}
                        {showSettings && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs gap-1.5 px-4 rounded-xl"
                                onClick={(e) => { e.stopPropagation(); handleOpenSettings(scenario.id) }}
                            >
                                <Settings className="w-3.5 h-3.5" />
                                {t('scenario.settings', language as Language)}
                            </ActionButton>
                        )}
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs gap-1.5 px-4 rounded-xl"
                            onClick={(e) => { e.stopPropagation(); handleOpenPromptConfig(scenario.id) }}
                            title={language === 'zh' ? '配置此场景的 Prompt' : 'Configure Prompt for this scene'}
                        >
                            <FileText className="w-3.5 h-3.5" />
                            {language === 'zh' ? 'Prompt' : 'Prompt'}
                        </ActionButton>
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs gap-1.5 px-4 rounded-xl"
                            onClick={(e) => { e.stopPropagation(); handleOpenDetail(scenario.id) }}
                        >
                            <Info className="w-3.5 h-3.5" />
                            {t('scenario.details', language as Language)}
                        </ActionButton>
                        {!isBuiltin && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs gap-1.5 px-4 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-400/10 ml-auto"
                                onClick={(e) => { e.stopPropagation(); handleRequestUninstall(scenario) }}
                            >
                                <PackageX className="w-3.5 h-3.5" />
                                {t('scenario.uninstall', language as Language)}
                            </ActionButton>
                        )}
                        {isBuiltin && !scenario.isDefault && (
                            <ActionButton
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs gap-1.5 px-4 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-400/10 ml-auto"
                                onClick={(e) => { e.stopPropagation(); handleRequestUninstall(scenario) }}
                            >
                                <PackageX className="w-3.5 h-3.5" />
                                {t('scenario.uninstall2', language as Language)}
                            </ActionButton>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full w-full relative">
            {/* 左侧导航 */}
            <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-10 pb-6 w-56 border-r border-border/40 shadow-xl shadow-black/10">
                <div className="px-4 mb-4">
                    <button
                        onClick={() => setShowScenarioPage(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent transition-all duration-200 group"
                    >
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-200" />
                        <span>{t('settings.backToApp', language as Language)}</span>
                    </button>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    <button
                        onClick={() => setActiveTab('installed')}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                            activeTab === 'installed'
                                ? 'bg-accent/10 text-text-primary border border-accent/20'
                                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
                        }`}
                    >
                        <span className={`transition-colors duration-200 ${activeTab === 'installed' ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                            <Package className="w-4 h-4" />
                        </span>
                        <span>{t('scenario.installed', language as Language)}</span>
                        <span className={`text-[10px] ml-auto ${activeTab === 'installed' ? 'text-accent/70' : 'opacity-60'}`}>({scenarios.length})</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('marketplace')}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                            activeTab === 'marketplace'
                                ? 'bg-accent/10 text-text-primary border border-accent/20'
                                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
                        }`}
                    >
                        <span className={`transition-colors duration-200 ${activeTab === 'marketplace' ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                            <Globe className="w-4 h-4" />
                        </span>
                        <span>{t('scenario.marketplace', language as Language)}</span>
                    </button>
                </nav>

                {activeTab === 'installed' && (
                    <div className="p-4 border-t border-border/30">
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="w-full h-8 gap-1.5 px-3 rounded-lg border border-dashed border-border/30 hover:border-accent/30 hover:text-accent justify-center"
                            onClick={handleInstallScenario}
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            {t('scenario.localinstall', language as Language)}
                        </ActionButton>
                    </div>
                )}
            </div>

            {/* 右侧内容 */}
            <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 w-full flex flex-col min-w-0 min-h-0 bg-transparent relative">
                    <div className="shrink-0 px-8 pt-10 pb-4 border-b border-border/40 drag-region">
                        <div className="no-drag">
                            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                                {activeTab === 'installed'
                                    ? t('scenario.installed', language as Language)
                                    : t('scenario.marketplace', language as Language)}
                            </h3>
                            <p className="text-sm text-text-muted mt-1.5 opacity-80">
                                {t('scenario.scenariomanager', language as Language)}
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col">
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
                </div>
            </div>

            {installState.phase !== 'idle' && (
                <OverlayDialog
                    isOpen
                    onClose={handleCloseInstall}
                    title={t('scenario.installscenario', language as Language)}
                    size="md"
                >
                    {installState.phase === 'selecting' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <FolderOpen className="w-8 h-8 text-accent/60" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {t('scenario.selectscenariodirectory', language as Language)}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'reading' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {t('scenario.readingscenarioconfig', language as Language)}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'confirming' && installState.config && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                {installState.config.icon ? (
                                    isImageIcon(installState.config.icon as string) ? (
                                        <img src={installState.config.icon as string} alt="" className="w-8 h-8 object-contain" />
                                    ) : (
                                        (() => { const C = ICON_MAP[installState.config.icon as string] || Package; return <C className="w-8 h-8 text-accent" strokeWidth={1.5} /> })()
                                    )
                                ) : (
                                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                                        <Package className="w-5 h-5 text-accent" strokeWidth={1.5} />
                                    </div>
                                )}
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
                                    {t('scenario.cancel', language as Language)}
                                </ActionButton>
                                <ActionButton variant="primary" size="sm" onClick={handleConfirmInstall}>
                                    {t('scenario.install', language as Language)}
                                </ActionButton>
                            </div>
                        </div>
                    )}
                    {installState.phase === 'installing' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {t('scenario.installingscenario', language as Language)}
                            </p>
                        </div>
                    )}
                    {installState.phase === 'success' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <CheckCircle2 className="w-8 h-8 text-green-400" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {t('scenario.installedsuccessfully', language as Language)}
                            </p>
                            <ActionButton variant="primary" size="sm" onClick={handleCloseInstall}>
                                {t('scenario.done', language as Language)}
                            </ActionButton>
                        </div>
                    )}
                    {installState.phase === 'error' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <XCircle className="w-8 h-8 text-red-400" strokeWidth={1.5} />
                            <p className="text-sm text-text-secondary">
                                {t('scenario.installationfailed', language as Language)}
                            </p>
                            <p className="text-[12px] text-text-muted max-w-md text-center">
                                {installState.error}
                            </p>
                            <ActionButton variant="primary" size="sm" onClick={handleCloseInstall}>
                                {t('scenario.close2', language as Language)}
                            </ActionButton>
                        </div>
                    )}
                </OverlayDialog>
            )}

            <DecisionOverlay
                isOpen={uninstallState?.isConfirming === true}
                title={t('scenario.confirmuninstall', language as Language)}
                message={t('scenario.areyousureyouwant', language as Language, { p0: uninstallState?.scenarioName })
                }
                confirmText={t('scenario.uninstall3', language as Language)}
                cancelText={t('scenario.cancel2', language as Language)}
                severity="danger"
                riskTag={t('scenario.irreversible', language as Language)}
                auditAction="scenario-uninstall"
                onConfirm={handleConfirmUninstall}
                onCancel={handleCancelUninstall}
            />

            {uninstallState?.isUninstalling && (
                <OverlayDialog isOpen onClose={() => {}} showCloseButton={false} size="sm">
                    <div className="flex flex-col items-center justify-center py-6 gap-3">
                        <Loader2 className="w-8 h-8 text-accent animate-spin" strokeWidth={1.5} />
                        <p className="text-sm text-text-secondary">
                            {t('scenario.uninstalling', language as Language, { scenarioName: uninstallState.scenarioName })
                            }
                        </p>
                        <p className="text-[11px] text-text-muted">
                            {t('scenario.runninguninstallscriptsandcleaning', language as Language)}
                        </p>
                    </div>
                </OverlayDialog>
            )}

            <OverlayDialog
                isOpen={detailScenarioId !== null}
                onClose={() => { setDetailScenarioId(null); setHealthReport(null) }}
                title={t('scenario.scenariodetails', language as Language)}
                size="lg"
            >
                {detailScenario && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-4">
                            {detailScenario.icon ? (
                                (() => {
                                    if (isImageIcon(detailScenario.icon)) {
                                        return <img src={detailScenario.icon} alt="" className="w-10 h-10 flex-shrink-0 rounded object-cover" />
                                    }
                                    const Icon = ICON_MAP[detailScenario.icon] || Sparkles
                                    return <Icon className="w-10 h-10 text-accent flex-shrink-0" strokeWidth={1.5} />
                                })()
                            ) : (
                                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                    <Sparkles className="w-7 h-7 text-accent" strokeWidth={1.5} />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-bold text-text-primary">
                                        {language === 'zh' ? detailScenario.nameZh : detailScenario.name}
                                    </h3>
                                    {detailScenario.isBuiltin && (
                                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">
                                            <Shield className="w-2.5 h-2.5" />
                                            {t('scenario.builtin2', language as Language)}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary mt-1">
                                    {language === 'zh' ? detailScenario.descriptionZh : detailScenario.description}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <InfoItem label={t('scenario.version', language as Language)} value={`v${detailScenario.version}`} />
                            <InfoItem label={t('scenario.author', language as Language)} value={detailScenario.author} />
                            <InfoItem
                                label={t('scenario.category', language as Language)}
                                value={CATEGORY_LABELS[detailScenario.category]?.[language === 'zh' ? 'zh' : 'en'] || detailScenario.category}
                            />
                            <InfoItem
                                label={t('scenario.source', language as Language)}
                                value={SOURCE_LABELS[detailScenario.source || (detailScenario.isBuiltin ? 'builtin' : 'local')]?.[language === 'zh' ? 'zh' : 'en'] || '-'}
                            />
                            <InfoItem
                                label={t('scenario.layout', language as Language)}
                                value={`${LAYOUT_ICONS[detailScenario.ui?.layout] || ''} ${detailScenario.ui?.layout || 'chat-centric'}`}
                            />
                            <InfoItem
                                label={t('scenario.workspace', language as Language)}
                                value={detailScenario.requiresWorkspace
                                    ? (t('scenario.yes', language as Language))
                                    : (t('scenario.no', language as Language))
                                }
                            />
                        </div>

                        {(detailScenario.tags?.length ?? 0) > 0 && (
                            <div>
                                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Tag className="w-3 h-3" />
                                    {t('scenario.tags', language as Language)}
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
                                {detailManifest.permissions && (detailManifest.permissions?.length ?? 0) > 0 && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <ShieldCheck className="w-3 h-3" />
                                            {t('scenario.permissions', language as Language)}
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

                                {detailManifest.dependencies && (detailManifest.dependencies?.length ?? 0) > 0 && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Layers className="w-3 h-3" />
                                            {t('scenario.dependencies', language as Language)}
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
                                                            {t('scenario.optional', language as Language)}
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
                                {t('scenario.runtimestatus', language as Language)}
                            </h4>
                            {isLoadingHealth ? (
                                <div className="flex items-center gap-2 text-[12px] text-text-muted">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {t('scenario.checking', language as Language)}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-[12px]">
                                        <span className="text-text-muted">{t('scenario.state', language as Language)}:</span>
                                        <StateBadge state={detailEntry?.state || 'unregistered'} language={language} />
                                    </div>
                                    {healthReport && (healthReport.checks?.length ?? 0) > 0 && (
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
                                            <span>{t('scenario.tools', language as Language)}: {healthReport.toolCount}</span>
                                            <span>{t('scenario.components', language as Language)}: {healthReport.componentCount}</span>
                                            {healthReport.uptime != null && (
                                                <span>{t('scenario.uptime', language as Language)}: {formatUptime(healthReport.uptime, language)}</span>
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
                                            {t('scenario.rollbackavailable', language as Language)}
                                        </h4>
                                        <p className="text-[11px] text-text-muted mt-1">
                                            {t('scenario.rollbacktovbacked', language as Language, { previousVersion: rollbackInfo.previousVersion, backedUpAt: new Date(rollbackInfo.backedUpAt).toLocaleString('en-US'), backedUpAt2: new Date(rollbackInfo.backedUpAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US') })
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
                                        {t('scenario.rollback', language as Language)}
                                    </ActionButton>
                                </div>
                            </div>
                        )}

                        {detailScenario.capabilities && (
                            <div>
                                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" />
                                    {t('scenario.capabilities', language as Language)}
                                </h4>
                                <div className="space-y-2">
                                    {(detailScenario.capabilities.toolPacks?.length ?? 0) > 0 && (
                                        <div>
                                            <span className="text-[11px] text-text-muted">{t('scenario.toolpacks', language as Language)}:</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {detailScenario.capabilities.toolPacks.map(tp => (
                                                    <span key={tp} className="text-[11px] px-2 py-0.5 rounded-md bg-accent/5 text-accent/80 border border-accent/10">
                                                        {tp}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {(detailScenario.capabilities.modes?.length ?? 0) > 0 && (
                                        <div>
                                            <span className="text-[11px] text-text-muted">{t('scenario.modes', language as Language)}:</span>
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
                                    {t('scenario.homepage', language as Language)}
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </OverlayDialog>

            <OverlayDialog
                isOpen={settingsScenarioId !== null}
                onClose={() => setSettingsScenarioId(null)}
                title={t('scenario.settings2', language as Language, { name: settingsScenario ? settingsScenario.name : '', nameZh: settingsScenario ? (language === 'zh' ? settingsScenario.nameZh : settingsScenario.name) : '' })
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
                            {t('scenario.scenariodoesnotprovidea', language as Language, { name: settingsScenario.name, nameZh: settingsScenario.nameZh })
                            }
                        </p>
                        <p className="text-[11px] text-text-muted/40 mt-1">
                            {t('scenario.developerscanregisterasettings', language as Language)
                            }
                        </p>
                    </div>
                ) : null}
            </OverlayDialog>

            {/* 场景级 Prompt 配置弹窗 */}
            {promptConfigScenarioId && (() => {
                const scenario = scenarioRegistry.get(promptConfigScenarioId)
                if (!scenario) return null
                return (
                    <ScenePromptConfigDialog
                        scenarioId={promptConfigScenarioId}
                        scenarioName={language === 'zh' ? scenario.nameZh : scenario.name}
                        language={language as Language}
                        onClose={() => setPromptConfigScenarioId(null)}
                    />
                )
            })()}
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
    language: Language
    scenarios: ScenarioPlugin[]
    filteredBuiltin: ScenarioPlugin[]
    filteredInstalled: ScenarioPlugin[]
    filterCategory: string | null
    setFilterCategory: (cat: string | null) => void
    sortedCategories: string[]
    renderScenarioCard: (scenario: ScenarioPlugin) => React.ReactNode
}) {
    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto px-8 pt-6 pb-8">
            {sortedCategories.length > 1 && (
                <div className="flex items-center gap-2 mb-6 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setFilterCategory(null)}
                        className={`text-xs px-4 py-2 rounded-xl whitespace-nowrap transition-all font-medium ${
                            !filterCategory
                                ? 'bg-accent/15 text-accent border border-accent/20'
                                : 'text-text-muted hover:text-text-primary border border-border/20 hover:border-border/40'
                        }`}
                    >
                        {t('scenario.all', language as Language)}
                    </button>
                    {sortedCategories.map(cat => {
                        const catLabel = CATEGORY_LABELS[cat] || CATEGORY_LABELS.custom
                        return (
                            <button
                                key={cat}
                                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                                className={`text-xs px-4 py-2 rounded-xl whitespace-nowrap transition-all font-medium ${
                                    filterCategory === cat
                                        ? 'bg-accent/15 text-accent border border-accent/20'
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
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Shield className="w-4 h-4 text-amber-400/70" strokeWidth={1.5} />
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                            {t('scenario.builtin3', language as Language)}
                        </span>
                        <span className="text-[11px] text-text-muted/50">({filteredBuiltin.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredBuiltin.map(renderScenarioCard)}
                    </div>
                </div>
            )}

            {filteredInstalled.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Package className="w-4 h-4 text-accent/70" strokeWidth={1.5} />
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                            {t('scenario.installed2', language as Language)}
                        </span>
                        <span className="text-[11px] text-text-muted/50">({filteredInstalled.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredInstalled.map(renderScenarioCard)}
                    </div>
                </div>
            )}

            {scenarios.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <Package className="w-16 h-16 text-text-muted/15 mb-5" strokeWidth={1} />
                    <p className="text-base text-text-muted/70 font-medium">
                        {t('scenario.noscenariosinstalled', language as Language)}
                    </p>
                    <p className="text-xs text-text-muted/40 mt-2">
                        {t('scenario.installfrommarketplaceorclick', language as Language)}
                    </p>
                </div>
            )}
        </div>
    )
}

function isImageIcon(val?: string | null): boolean {
    return !!val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:'))
}

function MarketplaceTab({ language, isAuthenticated }: { language: Language; isAuthenticated: boolean }) {
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

    /** 付费场景支付弹窗目标（付费购买 / 续费） */
    const [payTarget, setPayTarget] = useState<{
        item: MarketplaceScenario
        /** 权益已到期 → 续费（允许在有效期未满时顺延） */
        expired: boolean
    } | null>(null)

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

    useEffect(() => { loadFeatured(); loadCategories() }, [isAuthenticated])
    useEffect(() => { loadItems() }, [searchQuery, selectedCategory, page, isAuthenticated])

    async function loadItems() {
        setIsLoading(true)
        try {
            const result = await browseScenarios({ category: selectedCategory || undefined, search: searchQuery || undefined, page, limit: 20 })
            setItems(result.scenarios || [])
            setTotal(result.total || 0)
        } catch { setItems([]); setTotal(0) } finally { setIsLoading(false) }
    }
    async function loadFeatured() {
        try { const f = await getFeaturedScenarios(); setFeatured(f || []) } catch { /* ignore */ }
    }
    async function loadCategories() {
        try { const c = await getMarketplaceCategories(); setCategories(c || []) } catch { /* ignore */ }
    }
    function handleInstall(item: MarketplaceScenario) {
        if (scenarioRegistry.has(item.id)) { toast.warning(t('scenario.alreadyinstalled', language as Language)); return }
        if ((item.permissions?.length ?? 0) > 0) { setPermissionPending(item); return }
        doInstall(item)
    }
    async function doInstall(item: MarketplaceScenario) {
        setInstalling(item.id)
        try {
            const result = await installScenarioFromMarketplace(item.id, item.version)
            if (result.success) {
                const config = result.config
                const scenarioId = result.scenarioId || item.id
                if (config) await registerInstalledScenario(config as any, { scenarioId, source: 'marketplace', version: result.version })
                toast.success(t('scenario.scenarioinstalledsuccessfully', language as Language, { name: item.name, nameZh: item.nameZh }))
                setSelectedItem(null)
                await loadItems()
            } else if (result.requiresPayment) {
                // 付费场景未购买 / 权益已到期：弹出支付弹窗（支付成功后自动安装）
                setPayTarget({ item, expired: !!result.expired })
            } else {
                const errorMsg = translateInstallError(result.error || t('scenario.unknownerror2', language as Language))
                toast.card({ type: 'error', title: t('scenario.installfailed', language as Language), message: errorMsg, duration: 5000, source: 'ScenarioMarketplace' })
            }
        } catch (err) {
            const errorMsg = translateInstallError(err instanceof Error ? err.message : String(err))
            toast.card({ type: 'error', title: t('scenario.installfailed2', language as Language), message: errorMsg, duration: 5000, source: 'ScenarioMarketplace' })
        } finally { setInstalling(null) }
    }
    function renderStars(rating: number) {
        const stars = []
        for (let i = 1; i <= 5; i++) stars.push(<Star key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-yellow-300 fill-yellow-300' : 'text-border/40'}`} />)
        return <div className="flex items-center gap-0.5">{stars}</div>
    }

    /**
     * 付费场景支付弹窗（购买 / 续费）
     *
     * 下单、渠道选择、二维码、轮询与补单核实全部交给 PaymentDialog，
     * 支付成功后重新走一次安装流程（此时权益已发放）。
     * 组件内部使用 portal 渲染，放在任一 JSX 位置都不影响布局。
     */
    function renderPayDialog() {
        if (!payTarget) return null
        const { item, expired } = payTarget

        return (
            <PaymentDialog
                isOpen
                title={
                    expired
                        ? language === 'zh'
                            ? '续费场景'
                            : 'Renew Scenario'
                        : language === 'zh'
                            ? '购买场景'
                            : 'Buy Scenario'
                }
                subjectName={(language === 'zh' ? item.nameZh : item.name) || item.nameZh}
                amount={Number((item as any).price ?? 0)}
                language={language as Language}
                createOrder={async (channel) => {
                    const result = await createScenarioOrder(
                        item.id,
                        channel,
                        expired ? 'renew' : 'purchase',
                    )
                    if (!result.success || !result.orderNo) {
                        throw new Error(
                            result.error || (language === 'zh' ? '创建订单失败' : 'Failed to create order'),
                        )
                    }
                    return {
                        orderNo: result.orderNo,
                        amount: Number((item as any).price ?? 0),
                        payment: {
                            paymentUrl: result.paymentUrl,
                            qrCodeUrl: result.qrCodeUrl,
                            mockMode: result.mockMode,
                        },
                    }
                }}
                onPaid={async () => {
                    setPayTarget(null)
                    await doInstall(item)
                }}
                onClose={() => setPayTarget(null)}
                successHint={
                    language === 'zh'
                        ? '权益已生效，正在完成安装'
                        : 'Entitlement activated, installing now'
                }
            />
        )
    }


    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                <Globe className="w-12 h-12 text-text-muted/30 mb-4" strokeWidth={1} />
                <p className="text-sm text-text-muted mb-1">{t('app.pleaseloginfirst', language as Language)}</p>
                <p className="text-xs text-text-muted/60">{t('app.logintobrowse', language as Language)}</p>
            </div>
        )
    }

    // ── 详情视图 ──
    if (selectedItem) {
        return (
            <div className="p-6">
                <button onClick={() => setSelectedItem(null)} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-4 transition-colors">
                    <ArrowLeft className="w-3.5 h-3.5" />{t('app.backtolist', language as Language)}
                </button>
                <div>
                    {/* 头部卡片 */}
                    <div className="rounded-2xl border border-border/15 bg-surface/20 p-6 mb-6 shadow-sm shadow-black/5">
                        <div className="flex items-start gap-5">
                            {selectedItem.icon ? (
                                isImageIcon(selectedItem.icon) ? (
                                    <img src={selectedItem.icon} alt={selectedItem.name} className="w-16 h-16 flex-shrink-0 object-contain rounded-2xl bg-background/50" />
                                ) : (() => {
                                    const I = ICON_MAP[selectedItem.icon]
                                    return I
                                        ? <I className="w-16 h-16 text-accent flex-shrink-0" strokeWidth={1.5} />
                                        : <span className="text-4xl font-bold text-accent flex-shrink-0">{(language === 'zh' ? selectedItem.nameZh : selectedItem.name)?.[0]?.toUpperCase()}</span>
                                })()
                            ) : (
                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center text-accent flex-shrink-0 border border-accent/10">
                                    <span className="text-3xl font-bold">{(language === 'zh' ? selectedItem.nameZh : selectedItem.name)?.[0]?.toUpperCase()}</span>
                                </div>
                            )}
                            <div className="flex-1 min-w-0 pt-1">
                                <h2 className="text-2xl font-bold text-text-primary truncate">
                                    {language === 'zh' ? selectedItem.nameZh : selectedItem.name}
                                </h2>
                                <p className="text-sm text-text-secondary mt-1.5 line-clamp-2">{language === 'zh' ? selectedItem.descriptionZh : selectedItem.description}</p>
                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                    <span className={`px-3 py-1 text-xs rounded-lg font-medium ${selectedItem.isFree ? 'bg-green-500/10 text-green-400' : 'bg-accent/10 text-accent'}`}>
                                        {selectedItem.isFree ? t('app.free', language as Language) : `¥${selectedItem.price}`}
                                    </span>
                                    {selectedItem.category && (
                                        <span className="px-3 py-1 text-xs rounded-lg bg-surface/50 text-text-muted border border-border/15">
                                            {CATEGORY_LABELS[selectedItem.category]?.[language === 'zh' ? 'zh' : 'en'] || selectedItem.category}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 统计卡片 */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="text-center p-4 rounded-2xl bg-surface/20 border border-border/15">
                            <div className="text-xl font-bold text-text-primary flex items-center justify-center gap-1.5">
                                {selectedItem.rating.toFixed(1)} <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                            </div>
                            <div className="text-xs text-text-muted mt-1">{t('app.rating', language as Language)}</div>
                        </div>
                        <div className="text-center p-4 rounded-2xl bg-surface/20 border border-border/15">
                            <div className="text-xl font-bold text-text-primary">{selectedItem.downloads}</div>
                            <div className="text-xs text-text-muted mt-1">{t('app.downloads', language as Language)}</div>
                        </div>
                        <div className="text-center p-4 rounded-2xl bg-surface/20 border border-border/15">
                            <div className="text-xl font-bold text-text-primary">v{selectedItem.version}</div>
                            <div className="text-xs text-text-muted mt-1">{t('app.version', language as Language)}</div>
                        </div>
                    </div>

                    {selectedItem.tags?.length > 0 && (
                        <div className="mb-6">
                            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('app.tags', language as Language)}</h4>
                            <div className="flex flex-wrap gap-2">
                                {selectedItem.tags.map(tag => (
                                    <span key={tag} className="px-3 py-1 text-xs rounded-lg bg-surface/30 text-text-secondary border border-border/15 flex items-center gap-1.5"><Tag className="w-3 h-3" />{tag}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {selectedItem.minAppVersion && <div className="text-sm text-text-muted mb-4">{t('app.minappversion', language as Language, { minAppVersion: selectedItem.minAppVersion })}</div>}

                    <div className="flex items-center gap-2 text-sm text-text-muted mb-6"><Shield className="w-4 h-4 text-green-400" /><span>{t('app.securityreviewpassed', language as Language)}</span></div>

                    <div className="flex items-center gap-3 mb-8">
                        {scenarioRegistry.has(selectedItem.id) ? (
                            <ActionButton className="h-10 text-sm gap-2 px-6 rounded-xl" disabled><CheckCircle2 className="w-4 h-4" />{t('app.installed', language as Language)}</ActionButton>
                        ) : (
                            <ActionButton className="h-10 text-sm gap-2 px-6 rounded-xl" onClick={() => handleInstall(selectedItem)} disabled={installing === selectedItem.id}>
                                {installing === selectedItem.id ? <><Clock className="w-4 h-4 animate-spin" />{t('app.installing', language as Language)}</> : <><Download className="w-4 h-4" />{t('app.installscenario', language as Language)}</>}
                            </ActionButton>
                        )}
                    </div>

                    <ScenarioReviewPanel scenarioId={selectedItem.id} scenarioName={selectedItem.name} scenarioNameZh={selectedItem.nameZh} currentRating={selectedItem.rating} ratingCount={selectedItem.ratingCount} />
                </div>

                {/* 付费购买 / 续费弹窗 */}
                {renderPayDialog()}
            </div>
        )
    }

    // ── 列表视图 ──
    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* 顶部搜索栏 */}
            <div className="shrink-0 px-6 py-4 border-b border-border/10 bg-surface/20">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                        <input
                            type="text" value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                            placeholder={t('app.searchscenarios', language as Language)}
                            className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface/40 border border-border/20 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/40 transition-colors"
                        />
                    </div>
                    <button onClick={() => { loadItems(); loadFeatured(); loadCategories(); }}
                        className="p-2 rounded-xl hover:bg-surface/40 text-text-muted hover:text-text-primary transition-colors" title={t('app.refresh', language as Language)}>
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>

                {/* 分类筛选 */}
                <div className="flex items-center gap-2 mt-4 overflow-x-auto no-scrollbar">
                    <button onClick={() => { setSelectedCategory(null); setPage(1) }}
                        className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all ${!selectedCategory ? 'bg-accent/15 text-accent border border-accent/20' : 'text-text-muted hover:text-text-secondary border border-border/20 hover:border-border/40'}`}>
                        {t('app.all', language as Language)}
                    </button>
                    {categories.map(cat => (
                        <button key={cat.id} onClick={() => { setSelectedCategory(cat.id === selectedCategory ? null : cat.id); setPage(1) }}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 border ${cat.id === selectedCategory ? 'bg-accent/15 text-accent border border-accent/20' : 'text-text-muted hover:text-text-secondary border border-border/20 hover:border-border/40'}`}>
                            <span className="w-4 h-4">{CATEGORY_ICONS[cat.id]}</span>
                            <span>{cat.nameZh && language === 'zh' ? cat.nameZh : cat.name}</span>
                            <span className="opacity-60">{cat.count}</span>
                        </button>
                    ))}
                </div>
            </div>

                {/* 内容区域 */}
                <div className="flex-1 min-h-0 overflow-auto p-5">
                {/* 精选推荐 */}
                {featured.length > 0 && !searchQuery && !selectedCategory && (
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-accent" />
                            <h3 className="text-sm font-semibold text-text-primary">{t('app.featured', language as Language)}</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {featured.slice(0, 8).map(item => (
                                <button key={item.id} onClick={() => setSelectedItem(item)}
                                    className="rounded-2xl border border-border/15 bg-surface/20 hover:bg-surface/40 hover:border-accent/20 transition-all duration-200 group text-left overflow-hidden shadow-sm shadow-black/5">
                                    <div className="p-5">
                                        <div className="flex items-start gap-4">
                                            {item.icon ? (
                                                isImageIcon(item.icon) ? (
                                                    <img src={item.icon} alt={item.name} className="w-12 h-12 flex-shrink-0 object-contain rounded-xl bg-background/50" />
                                                ) : (() => {
                                                    const I = ICON_MAP[item.icon]
                                                    return I
                                                        ? <I className="w-12 h-12 text-accent flex-shrink-0 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                                                        : <span className="text-2xl font-bold text-accent flex-shrink-0">{(language === 'zh' ? item.nameZh : item.name)?.[0]?.toUpperCase()}</span>
                                                })()
                                            ) : (
                                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center text-accent flex-shrink-0 border border-accent/10">
                                                    <span className="text-xl font-bold">{(language === 'zh' ? item.nameZh : item.name)?.[0]?.toUpperCase()}</span>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0 pt-1">
                                                <span className="text-base font-semibold text-text-primary truncate block">{language === 'zh' ? item.nameZh : item.name}</span>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    {renderStars(item.rating)}
                                                    <span className="text-xs text-text-muted">{item.downloads} {t('app.dl', language as Language)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 搜索结果 / 全部 */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-text-primary">
                            {searchQuery || selectedCategory ? t('app.searchresults', language as Language) : t('app.allscenarios', language as Language)}
                            {total > 0 && <span className="ml-1.5 text-text-muted font-normal text-xs">({total})</span>}
                        </h3>
                        {isLoading && <Loader2 className="w-4 h-4 text-text-muted animate-spin" />}
                    </div>

                    {items.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
                            <Package className="w-10 h-10 mb-3 opacity-30" strokeWidth={1} />
                            <p className="text-sm">{t('app.noscenariosfound', language as Language)}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {items.map(item => (
                            <button key={item.id} onClick={() => setSelectedItem(item)}
                                className="rounded-2xl border border-border/15 bg-surface/20 hover:bg-surface/40 hover:border-accent/20 transition-all duration-200 group text-left overflow-hidden shadow-sm shadow-black/5">
                                <div className="p-5">
                                    <div className="flex items-start gap-4">
                                        {item.icon ? (
                                            isImageIcon(item.icon) ? (
                                                <img src={item.icon} alt={item.name} className="w-12 h-12 flex-shrink-0 object-contain rounded-xl bg-background/50" />
                                            ) : (() => {
                                                const I = ICON_MAP[item.icon]
                                                return I
                                                    ? <I className="w-12 h-12 text-accent flex-shrink-0 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                                                    : <span className="text-2xl font-bold text-accent flex-shrink-0">{(language === 'zh' ? item.nameZh : item.name)?.[0]?.toUpperCase()}</span>
                                            })()
                                        ) : (
                                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center text-accent flex-shrink-0 border border-accent/10">
                                                <span className="text-xl font-bold">{(language === 'zh' ? item.nameZh : item.name)?.[0]?.toUpperCase()}</span>
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0 pt-1">
                                            <span className="text-base font-semibold text-text-primary truncate block">{language === 'zh' ? item.nameZh : item.name}</span>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                {renderStars(item.rating)}
                                                <span className="text-xs text-text-muted">{item.downloads} {t('app.dl', language as Language)}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-2">
                                                {item.isFree && <span className="px-2 py-0.5 text-xs rounded-lg bg-green-500/10 text-green-400 font-medium">{t('app.free', language as Language)}</span>}
                                                {!item.isFree && <span className="px-2 py-0.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 font-medium">¥{item.price}</span>}
                                                {scenarioRegistry.has(item.id) && <span className="px-2 py-0.5 text-xs rounded-lg bg-accent/10 text-accent font-medium">{t('app.installed2', language as Language)}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-xs text-text-muted/70 mt-4 line-clamp-2 leading-relaxed">
                                        {language === 'zh' ? item.descriptionZh : item.description}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>

                    {total > 20 && (
                        <div className="flex items-center justify-center gap-3 mt-6">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                className="px-3 py-1.5 text-[11px] rounded-lg bg-surface/30 text-text-muted disabled:opacity-40 hover:bg-surface/50 transition-colors">{t('app.prev', language as Language)}</button>
                            <span className="text-[11px] text-text-muted">{page} / {Math.ceil(total / 20)}</span>
                            <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}
                                className="px-3 py-1.5 text-[11px] rounded-lg bg-surface/30 text-text-muted disabled:opacity-40 hover:bg-surface/50 transition-colors">{t('app.next', language as Language)}</button>
                        </div>
                    )}
                </div>
            </div>

            {permissionPending && (
                <PermissionConfirmDialog
                    scenarioName={permissionPending.name}
                    scenarioNameZh={permissionPending.nameZh}
                    permissions={permissionPending.permissions || []}
                    onConfirm={() => { setPermissionPending(null); doInstall(permissionPending) }}
                    onCancel={() => setPermissionPending(null)}
                />
            )}

            {/* 付费购买 / 续费弹窗 */}
            {renderPayDialog()}
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

function StateBadge({ state, language }: { state: string; language: Language }) {
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

function formatUptime(ms: number, language: Language): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return t('scenario.s', language as Language, { seconds: seconds })
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('scenario.m', language as Language, { minutes: minutes })
    const hours = Math.floor(minutes / 60)
    return t('scenario.h', language as Language, { hours: hours })
}
