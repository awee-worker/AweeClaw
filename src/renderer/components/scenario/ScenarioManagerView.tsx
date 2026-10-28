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
    ArrowUpCircle, ChevronRight,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core/ScenarioLoader'
import { scenarioDatabaseManager } from '@scenario-system/core/ScenarioDatabaseManager'
import { api } from '../../adapters/electronBridge'
import { ActionButton, OverlayDialog, HintOverlay } from '../ui'
import DecisionOverlay from '@components/foundation/DecisionOverlay'
import { PermissionConfirmDialog } from './PermissionConfirmDialog'
import { ScenarioReviewPanel } from './ScenarioReviewPanel'
import { ScenePromptConfigDialog } from './ScenePromptConfigDialog'
import type { ScenarioPlugin, UILayout } from '@shared/protocols/scenario'
import { activateScenarioPanels, switchToFirstPanel } from './panelUtils'
import { registerInstalledScenario } from './scenarioInstallUtils'
import {
    applyInstalledScenarioUpdate,
    cacheMarketplaceIcons,
    checkInstalledScenarioUpdates,
    findInstalledScenarioId,
    resolveMarketplaceId,
    resolveScenarioIcon,
    syncInstalledScenarioIcons,
    unlinkMarketplaceScenario,
} from '../../adapters/scenarioMarketplaceMap'
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
    /** 已安装列表的手动「检查更新」是否进行中 */
    const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
    /**
     * 图标补齐后的重渲染标记
     *
     * 市场图标缓存写在 localStorage，registry 本身不是响应式的，补完图标必须主动
     * 触发一次渲染，否则卡片还停在场景包自带的旧图标上。
     */
    const [, setIconSyncTick] = useState(0)
    useEffect(() => {
        let cancelled = false
        void syncInstalledScenarioIcons()
            .then((applied) => {
                if (!cancelled && applied > 0) setIconSyncTick((v) => v + 1)
            })
            .catch(() => { /* 补图失败不阻断页面 */ })
        return () => { cancelled = true }
    }, [])
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
                // 内置场景随客户端发版更新，只有市场安装的场景需要检查
                const installed = scenarioRegistry.getInstalled().filter(s => !s.isBuiltin)
                const checkList = installed.map(s => ({ id: resolveMarketplaceId(s), version: s.version || '1.0.0' }))
                if (checkList.length === 0) return
                const results = await checkScenarioUpdates(checkList)
                // 后端按市场 ID 返回结果，卡片按本地场景 ID 取用，这里换回本地 ID
                const map = new Map<string, MarketplaceUpdateInfo>()
                results.forEach(r => {
                    const target = installed.find(s => resolveMarketplaceId(s) === r.scenarioId)
                    if (target) map.set(target.id, r)
                })
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
            // 后端按市场 ID 查包，本地场景 ID 未必等于市场 ID
            const scenario = scenarioRegistry.get(scenarioId)
            const marketId = scenario ? resolveMarketplaceId(scenario) : scenarioId
            const result = await updateScenarioFromMarketplace(marketId, updateInfo.latestVersion)
            if (result.success) {
                // 更新只替换磁盘文件，重新注册让新版本的场景配置立即生效
                const config = result.config as Record<string, unknown> | undefined
                if (config) {
                    try {
                        await registerInstalledScenario(config as any, {
                            scenarioId: result.scenarioId || scenarioId,
                            source: 'marketplace',
                            version: result.version,
                            marketplaceId: marketId,
                            icon: updateInfo.scenarioIcon,
                        })
                    } catch (registerErr) {
                        logger.scenario.warn('[ScenarioManager] Re-register after update failed:', registerErr)
                        scenarioRegistry.updateScenario(scenarioId, { version: result.version })
                    }
                }
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

    /**
     * 检查已安装场景的更新并直接升级
     *
     * 与插件与技能市场的「检查更新」保持一致：查出新版本后不再让用户逐条点，
     * 而是串行自动升级（并发写运行时目录会互相打断），最后统一汇总结果。
     */
    const handleCheckAllUpdates = useCallback(async () => {
        if (isCheckingUpdates) return
        setIsCheckingUpdates(true)
        try {
            const candidates = await checkInstalledScenarioUpdates()
            if (candidates.length === 0) {
                toast.success(language === 'zh' ? '所有场景均为最新版本' : 'All scenarios are up to date')
                return
            }

            const updated: string[] = []
            const failed: string[] = []
            const nextUpdates = new Map(scenarioUpdates)

            for (const candidate of candidates) {
                setUpdatingScenarioId(candidate.installedId)
                const outcome = await applyInstalledScenarioUpdate(candidate)
                if (!outcome.success) {
                    failed.push(`${language === 'zh' ? candidate.nameZh : candidate.name}：${translateInstallError(outcome.error || '')}`)
                    continue
                }

                // 更新只替换磁盘文件，重新注册让新版本配置立即生效
                const config = outcome.config
                try {
                    if (config) {
                        await registerInstalledScenario(config as any, {
                            scenarioId: outcome.resolvedScenarioId || candidate.installedId,
                            source: 'marketplace',
                            version: candidate.latestVersion,
                            marketplaceId: candidate.marketId,
                            icon: scenarioUpdates.get(candidate.installedId)?.scenarioIcon,
                        })
                    } else {
                        scenarioRegistry.updateScenario(candidate.installedId, { version: candidate.latestVersion })
                    }
                } catch (registerErr) {
                    logger.scenario.warn('[ScenarioManager] Re-register after update failed:', registerErr)
                    scenarioRegistry.updateScenario(candidate.installedId, { version: candidate.latestVersion })
                }
                nextUpdates.delete(candidate.installedId)
                updated.push(`${language === 'zh' ? candidate.nameZh : candidate.name} v${candidate.latestVersion}`)
            }

            setScenarioUpdates(nextUpdates)
            setUpdatingScenarioId(null)

            if (failed.length === 0) {
                toast.card({
                    type: 'success',
                    title: language === 'zh'
                        ? `${updated.length} 个场景已更新`
                        : `${updated.length} scenario(s) updated`,
                    message: updated.join(language === 'zh' ? '、' : ', '),
                    duration: 8000,
                    source: 'ScenarioMarketplace',
                })
            } else {
                const parts: string[] = []
                if (updated.length > 0) {
                    parts.push(language === 'zh'
                        ? `已更新 ${updated.length} 个：${updated.join('、')}`
                        : `${updated.length} updated: ${updated.join(', ')}`)
                }
                parts.push(language === 'zh'
                    ? `失败 ${failed.length} 个：${failed.join('；')}`
                    : `${failed.length} failed: ${failed.join('; ')}`)
                toast.card({
                    type: 'error',
                    title: language === 'zh' ? '部分场景更新失败' : 'Some scenarios failed to update',
                    message: parts.join('；'),
                    duration: 10000,
                    source: 'ScenarioMarketplace',
                })
            }
        } catch (err) {
            logger.scenario.warn('[ScenarioManager] Check updates failed:', err)
            toast.card({
                type: 'error',
                title: t('app.failedtocheckupdates', language as Language),
                message: err instanceof Error ? err.message : String(err),
                duration: 5000,
                source: 'ScenarioMarketplace',
            })
        } finally {
            setUpdatingScenarioId(null)
            setIsCheckingUpdates(false)
        }
    }, [isCheckingUpdates, scenarioUpdates, language])

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
            // 清掉市场条目映射，避免市场页仍显示「已安装」
            unlinkMarketplaceScenario(uninstallState.scenarioId)

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

    /**
     * 安装完成后直接进入场景
     *
     * 安装只把场景写进注册表，不会自动切换当前场景。此时左侧导航仍是旧场景的菜单，
     * 用户关掉弹窗后找不到新场景的入口，会以为「装了但没生效」。
     * 这里复用切换逻辑（切换场景 + 注册面板 + 落到第一块面板），并关掉全屏页，
     * 让用户装完立刻看到新场景的导航与首屏面板。
     */
    const handleEnterInstalled = useCallback(() => {
        const scenarioId = installState.scenarioId
        if (!scenarioId) return

        const scenario = scenarioRegistry.get(scenarioId)
        if (!scenario) {
            toast.error(t('menu.scenario.switchFailed', language as Language))
            handleCloseInstall()
            return
        }

        handleSwitch(scenario)
        handleCloseInstall()
        useStore.getState().closeAllFullPages()
    }, [installState.scenarioId, handleSwitch, handleCloseInstall, language])

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
    /** 详情页图标同样以市场图标为准 */
    const detailIcon = detailScenario ? resolveScenarioIcon(detailScenario) : undefined
    const detailManifest = detailScenarioId ? scenarioLoader.getManifest(detailScenarioId) : null
    const detailEntry = detailScenarioId ? scenarioLoader.getEntry(detailScenarioId) : null

    const settingsScenario = settingsScenarioId ? scenarioRegistry.get(settingsScenarioId) : null
    const SettingsComponent = settingsScenarioId ? getSettingsComponent(settingsScenarioId) : null

    const renderScenarioCard = (scenario: ScenarioPlugin) => {
        // 已安装场景展示它在场景应用市场里的图标，避免与市场卡片对不上
        const cardIcon = resolveScenarioIcon(scenario)
        const IconComponent = ICON_MAP[cardIcon || ''] || Sparkles
        const isActive = scenario.id === activeScenarioId
        const isBuiltin = scenario.isBuiltin === true
        const catLabel = CATEGORY_LABELS[scenario.category] || CATEGORY_LABELS.custom
        const sourceInfo = SOURCE_LABELS[scenario.source || (isBuiltin ? 'builtin' : 'local')]
        const SourceIcon = sourceInfo?.icon || Package
        const showSettings = scenario.hasSettings === true
        const updateInfo = scenarioUpdates.get(scenario.id)
        const isUpdating = updatingScenarioId === scenario.id
        const displayName = language === 'zh' ? scenario.nameZh : scenario.name
        const description = language === 'zh' ? scenario.descriptionZh : scenario.description

        /**
         * 底部工具按钮：图标态，hover 才出底色，避免一排按钮把卡片压垮
         *
         * 说明文字走 HintOverlay，不用 title —— 原生 title 有 1s 以上延迟、
         * 样式跟随系统且无法控制位置，与卡片底部贴边时容易被窗口裁掉。
         * 提示固定在上方，Icon 仍保留 aria-label 供读屏使用。
         */
        const toolButton = (
            icon: LucideIcon,
            label: string,
            onClick: () => void,
            danger = false,
        ) => {
            const ToolIcon = icon
            return (
                <HintOverlay key={label} content={label} side="top">
                    <button
                        aria-label={label}
                        onClick={(e) => { e.stopPropagation(); onClick() }}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                            danger
                                ? 'text-text-muted/70 hover:text-red-400 hover:bg-red-400/10'
                                : 'text-text-muted hover:text-accent hover:bg-accent/10'
                        }`}
                    >
                        <ToolIcon className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                </HintOverlay>
            )
        }

        return (
            <div
                key={scenario.id}
                onClick={() => handleOpenDetail(scenario.id)}
                className={`group flex flex-col rounded-xl border bg-surface overflow-hidden cursor-pointer transition-all duration-200 hover:border-accent/50 hover:shadow-lg hover:shadow-black/10 hover:-translate-y-0.5 ${
                    isActive ? 'border-accent/50' : 'border-border/60'
                }`}
            >
                {/* 头部：图标 + 名称 + 徽章 + 元信息 */}
                <div className="flex items-start gap-3 px-4 pt-4">
                    <span className={`w-11 h-11 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center border ${
                        isActive ? 'bg-accent/10 border-accent/25' : 'bg-accent/10 border-accent/20'
                    }`}>
                        {cardIcon ? (
                            isImageIcon(cardIcon) ? (
                                <img src={cardIcon} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <IconComponent className="w-5 h-5 text-accent" strokeWidth={1.75} />
                            )
                        ) : (
                            <span className="text-base font-bold text-accent">{displayName?.[0]?.toUpperCase()}</span>
                        )}
                    </span>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-text-primary truncate">{displayName}</span>
                            {isActive && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded-md flex-shrink-0">
                                    <Check className="w-2.5 h-2.5" />
                                    {t('scenario.active', language as Language)}
                                </span>
                            )}
                            {isBuiltin && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-md flex-shrink-0">
                                    <Shield className="w-2.5 h-2.5" />
                                    {t('scenario.builtin', language as Language)}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-muted">
                            <span className={catLabel.color}>
                                {language === 'zh' ? catLabel.zh : catLabel.en}
                            </span>
                            <span className="text-border/60">·</span>
                            <span>v{scenario.version}</span>
                            <span className="text-border/60">·</span>
                            <SourceIcon className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{language === 'zh' ? sourceInfo?.zh : sourceInfo?.en}</span>
                        </div>
                    </div>
                </div>

                <p className="px-4 pt-3 text-xs leading-relaxed text-text-secondary line-clamp-2">
                    {description}
                </p>

                {updateInfo && (
                    <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/15">
                        <ArrowUpCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="text-[11px] text-blue-400 font-medium truncate">
                            {t('scenario.vavailable', language as Language, { latestVersion: updateInfo.latestVersion })}
                        </span>
                        {isUpdating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 ml-auto flex-shrink-0" />
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleUpdateScenario(scenario.id) }}
                                className="ml-auto text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors font-medium flex-shrink-0"
                            >
                                {t('scenario.update', language as Language)}
                            </button>
                        )}
                    </div>
                )}

                {/* 底部操作栏：主操作在左，工具在右 */}
                <div className="mt-auto flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border/40 bg-background-secondary/50">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {!isActive ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleSwitch(scenario) }}
                                className="h-7 px-2.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-[11px] font-medium flex items-center gap-1 transition-colors"
                            >
                                <Check className="w-3 h-3" />
                                {t('scenario.switch', language as Language)}
                            </button>
                        ) : (
                            <span className="text-[11px] text-text-muted flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-accent" />
                                {language === 'zh' ? '当前使用中' : 'In use'}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-0.5 flex-shrink-0">
                        {showSettings && toolButton(Settings, t('scenario.settings', language as Language), () => handleOpenSettings(scenario.id))}
                        {toolButton(FileText, language === 'zh' ? '配置 Prompt' : 'Configure Prompt', () => handleOpenPromptConfig(scenario.id))}
                        {toolButton(Info, t('scenario.details', language as Language), () => handleOpenDetail(scenario.id))}
                        {isBuiltin
                            ? (!scenario.isDefault && toolButton(PackageX, t('scenario.uninstall2', language as Language), () => handleRequestUninstall(scenario), true))
                            : toolButton(PackageX, t('scenario.uninstall', language as Language), () => handleRequestUninstall(scenario), true)}
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
                                onCheckUpdates={handleCheckAllUpdates}
                                isCheckingUpdates={isCheckingUpdates}
                                hasInstalledScenarios={installedScenarios.length > 0}
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
                            <p className="text-[12px] text-text-muted max-w-md text-center">
                                {t('scenario.installedsuccesshint', language as Language)}
                            </p>
                            <div className="flex items-center gap-2">
                                <ActionButton variant="ghost" size="sm" onClick={handleCloseInstall}>
                                    {t('scenario.done', language as Language)}
                                </ActionButton>
                                <ActionButton variant="primary" size="sm" onClick={handleEnterInstalled}>
                                    {t('scenario.enternow', language as Language)}
                                </ActionButton>
                            </div>
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
                message={t('scenario.areyousureyouwant', language as Language, { name: uninstallState?.scenarioName ?? '' })}
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
                            {detailIcon ? (
                                (() => {
                                    if (isImageIcon(detailIcon)) {
                                        return <img src={detailIcon} alt="" className="w-10 h-10 flex-shrink-0 rounded object-cover" />
                                    }
                                    const Icon = ICON_MAP[detailIcon] || Sparkles
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
                                            {t('scenario.rollbacktovbacked', language as Language, {
                                                previousVersion: rollbackInfo.previousVersion,
                                                backedUpAt: new Date(rollbackInfo.backedUpAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US'),
                                            })}
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
                title={t('scenario.settings2', language as Language, {
                    name: settingsScenario?.name ?? '',
                    nameZh: settingsScenario?.nameZh || settingsScenario?.name || '',
                })}
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
    onCheckUpdates,
    isCheckingUpdates,
    hasInstalledScenarios,
}: {
    language: Language
    scenarios: ScenarioPlugin[]
    filteredBuiltin: ScenarioPlugin[]
    filteredInstalled: ScenarioPlugin[]
    filterCategory: string | null
    setFilterCategory: (cat: string | null) => void
    sortedCategories: string[]
    renderScenarioCard: (scenario: ScenarioPlugin) => React.ReactNode
    onCheckUpdates: () => void
    isCheckingUpdates: boolean
    hasInstalledScenarios: boolean
}) {
    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* 顶部工具栏：与场景市场同一层级，固定不随内容滚动 */}
            <div className="shrink-0 px-6 py-4 border-b border-border/60 bg-background-secondary">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-accent" strokeWidth={1.75} />
                            <h2 className="text-sm font-semibold text-text-primary">
                                {t('scenario.installed2', language as Language)}
                            </h2>
                            <span className="text-xs text-text-muted">({scenarios.length})</span>
                        </div>
                        <p className="mt-1 text-[11px] text-text-muted/70 truncate">
                            {language === 'zh'
                                ? '检查到新版本会自动更新已安装的场景'
                                : 'Installed scenarios are updated automatically when a new version is found'}
                        </p>
                    </div>
                    {hasInstalledScenarios && (
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 gap-1.5 rounded-lg border border-border/30 hover:border-accent/30 hover:text-accent flex-shrink-0"
                            onClick={onCheckUpdates}
                            disabled={isCheckingUpdates}
                        >
                            {isCheckingUpdates ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {language === 'zh' ? '检查中…' : 'Checking…'}
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    {language === 'zh' ? '检查更新' : 'Check updates'}
                                </>
                            )}
                        </ActionButton>
                    )}
                </div>

                {/* 分类筛选：带图标与数量，与市场分类栏保持一致 */}
                {sortedCategories.length > 1 && (
                    <div className="flex items-center gap-2 mt-4 overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setFilterCategory(null)}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                !filterCategory
                                    ? 'bg-accent/15 text-accent border-accent/20'
                                    : 'text-text-muted hover:text-text-secondary border-border/20 hover:border-border/40'
                            }`}
                        >
                            {t('scenario.all', language as Language)}
                            <span className="opacity-60">{scenarios.length}</span>
                        </button>
                        {sortedCategories.map(cat => {
                            const catLabel = CATEGORY_LABELS[cat] || CATEGORY_LABELS.custom
                            const count = scenarios.filter(s => s.category === cat).length
                            return (
                                <button
                                    key={cat}
                                    onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                                    className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                        filterCategory === cat
                                            ? 'bg-accent/15 text-accent border-accent/20'
                                            : 'text-text-muted hover:text-text-secondary border-border/20 hover:border-border/40'
                                    }`}
                                >
                                    <span className="w-4 h-4 flex items-center justify-center">
                                        {CATEGORY_ICONS[cat] || <Sparkles className="w-4 h-4" />}
                                    </span>
                                    <span>{language === 'zh' ? catLabel.zh : catLabel.en}</span>
                                    <span className="opacity-60">{count}</span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* 内容区：滚动只发生在这一层 */}
            <div className="flex-1 min-h-0 overflow-auto p-5">
                {filteredBuiltin.length > 0 && (
                    <section className="mb-8">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 rounded-lg bg-amber-400/15 border border-amber-400/25 flex items-center justify-center">
                                <Shield className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
                            </span>
                            <h3 className="text-sm font-semibold text-text-primary">
                                {t('scenario.builtin3', language as Language)}
                            </h3>
                            <span className="text-xs text-text-muted font-normal">({filteredBuiltin.length})</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredBuiltin.map(renderScenarioCard)}
                        </div>
                    </section>
                )}

                {filteredInstalled.length > 0 && (
                    <section className="mb-8">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
                                <Package className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />
                            </span>
                            <h3 className="text-sm font-semibold text-text-primary">
                                {t('scenario.installed2', language as Language)}
                            </h3>
                            <span className="text-xs text-text-muted font-normal">({filteredInstalled.length})</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredInstalled.map(renderScenarioCard)}
                        </div>
                    </section>
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
            // 市场条目自带图标，顺手缓存给已安装场景用，省掉逐个请求详情
            cacheMarketplaceIcons(result.scenarios || [])
            setItems(result.scenarios || [])
            setTotal(result.total || 0)
        } catch { setItems([]); setTotal(0) } finally { setIsLoading(false) }
    }
    async function loadFeatured() {
        try {
            const f = await getFeaturedScenarios()
            cacheMarketplaceIcons(f || [])
            setFeatured(f || [])
        } catch { /* ignore */ }
    }
    async function loadCategories() {
        try { const c = await getMarketplaceCategories(); setCategories(c || []) } catch { /* ignore */ }
    }
    function handleInstall(item: MarketplaceScenario) {
        // 市场条目 ID 与本地场景 ID 可能不同，统一走映射判断
        if (findInstalledScenarioId(item)) { toast.warning(t('scenario.alreadyinstalled', language as Language)); return }
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
                if (config) {
                    await registerInstalledScenario(config as any, {
                        scenarioId,
                        source: 'marketplace',
                        version: result.version,
                        marketplaceId: item.id,
                        icon: item.icon,
                    })
                }
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
     * 市场卡片
     *
     * 卡面用实心 surface 配清晰描边压出层次：低透明度叠加在 background 上几乎没有
     * 色差，卡片会和背景糊成一片。hover 只做轻微上浮与描边提亮，不做缩放 ——
     * 网格整体缩放时相邻卡片会跟着抖。
     */
    function renderMarketplaceCard(item: MarketplaceScenario) {
        const displayName = language === 'zh' ? item.nameZh : item.name
        const description = language === 'zh' ? item.descriptionZh : item.description
        const installed = !!findInstalledScenarioId(item)
        const iconFallback = (
            <span className="w-11 h-11 flex-shrink-0 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-base font-bold text-accent">
                {displayName?.[0]?.toUpperCase()}
            </span>
        )

        return (
            <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="group flex flex-col rounded-xl border border-border/60 bg-surface text-left overflow-hidden transition-all duration-200 hover:border-accent/50 hover:shadow-lg hover:shadow-black/10 hover:-translate-y-0.5"
            >
                <div className="flex items-start gap-3 px-4 pt-4">
                    {item.icon ? (
                        isImageIcon(item.icon) ? (
                            <img
                                src={item.icon}
                                alt={item.name}
                                className="w-11 h-11 flex-shrink-0 rounded-xl object-contain bg-background border border-border/50"
                            />
                        ) : (
                            (() => {
                                const I = ICON_MAP[item.icon]
                                return I ? (
                                    <span className="w-11 h-11 flex-shrink-0 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                                        <I className="w-5 h-5 text-accent" strokeWidth={1.75} />
                                    </span>
                                ) : iconFallback
                            })()
                        )
                    ) : (
                        iconFallback
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-text-primary truncate">{displayName}</span>
                            {installed && <CheckCircle2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                            {renderStars(item.rating)}
                            <span className="text-[11px] text-text-muted">
                                {item.downloads} {t('app.dl', language as Language)}
                            </span>
                        </div>
                    </div>
                </div>

                <p className="px-4 pt-3 pb-4 text-xs leading-relaxed text-text-secondary line-clamp-2">
                    {description}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border/40 bg-background-secondary/50">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {item.isFree ? (
                            <span className="px-2 py-0.5 text-[11px] rounded-md bg-emerald-500/15 text-emerald-400 font-medium">
                                {t('app.free', language as Language)}
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 text-[11px] rounded-md bg-amber-500/15 text-amber-400 font-medium">
                                ¥{item.price}
                            </span>
                        )}
                        {item.category && (
                            <span className="text-[11px] text-text-muted truncate">
                                {CATEGORY_LABELS[item.category]?.[language === 'zh' ? 'zh' : 'en'] || item.category}
                            </span>
                        )}
                    </div>
                    <span className="flex items-center gap-0.5 text-[11px] text-text-muted transition-colors group-hover:text-accent flex-shrink-0">
                        {language === 'zh' ? '详情' : 'Details'}
                        <ChevronRight className="w-3 h-3" />
                    </span>
                </div>
            </button>
        )
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
            <div className="p-6 max-w-5xl mx-auto">
                <button onClick={() => setSelectedItem(null)} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-4 transition-colors">
                    <ArrowLeft className="w-3.5 h-3.5" />{t('app.backtolist', language as Language)}
                </button>
                <div>
                    {/* 头部卡片 */}
                    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-surface p-6 mb-6 shadow-sm shadow-black/10">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/[0.07] to-transparent" />
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
                        <div className="text-center p-4 rounded-xl bg-surface border border-border/50">
                            <div className="text-xl font-bold text-text-primary flex items-center justify-center gap-1.5">
                                {selectedItem.rating.toFixed(1)} <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                            </div>
                            <div className="text-xs text-text-muted mt-1">{t('app.rating', language as Language)}</div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-surface border border-border/50">
                            <div className="text-xl font-bold text-text-primary">{selectedItem.downloads}</div>
                            <div className="text-xs text-text-muted mt-1">{t('app.downloads', language as Language)}</div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-surface border border-border/50">
                            <div className="text-xl font-bold text-text-primary">v{selectedItem.version}</div>
                            <div className="text-xs text-text-muted mt-1">{t('app.version', language as Language)}</div>
                        </div>
                    </div>

                    {selectedItem.tags?.length > 0 && (
                        <div className="mb-6">
                            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('app.tags', language as Language)}</h4>
                            <div className="flex flex-wrap gap-2">
                                {selectedItem.tags.map(tag => (
                                    <span key={tag} className="px-3 py-1 text-xs rounded-lg bg-background-secondary text-text-secondary border border-border/50 flex items-center gap-1.5"><Tag className="w-3 h-3" />{tag}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {selectedItem.minAppVersion && <div className="text-sm text-text-muted mb-4">{t('app.minappversion', language as Language, { minAppVersion: selectedItem.minAppVersion })}</div>}

                    <div className="flex items-center gap-2 text-sm text-text-muted mb-6"><Shield className="w-4 h-4 text-green-400" /><span>{t('app.securityreviewpassed', language as Language)}</span></div>

                    <div className="flex items-center gap-3 mb-8">
                        {findInstalledScenarioId(selectedItem) ? (
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
            <div className="shrink-0 px-6 py-4 border-b border-border/60 bg-background-secondary">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                        <input
                            type="text" value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                            placeholder={t('app.searchscenarios', language as Language)}
                            className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted/60 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 transition-all"
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
                    <section className="mb-8">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
                                <Sparkles className="w-3.5 h-3.5 text-accent" />
                            </span>
                            <h3 className="text-sm font-semibold text-text-primary">{t('app.featured', language as Language)}</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {featured.slice(0, 8).map(renderMarketplaceCard)}
                        </div>
                    </section>
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
                        {items.map(renderMarketplaceCard)}

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
