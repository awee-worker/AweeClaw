import { lazy, Suspense, useMemo, useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { Cpu, Settings2, Shield, Monitor, Plug, Brain, FileText, Zap, X, Palette, Radio, Eye, Search, Mail, Mic, MonitorSmartphone, ArrowLeft, ScanEye, Activity, Network, Cable, Sparkles, Puzzle, Layers } from 'lucide-react'
import { PROVIDERS } from '@configuration/aiProviders'
import { t, type Language } from '@renderer/i18n'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { ActionButton, OverlayDialog } from '@components/ui'
import { SettingsTab } from './preferencesTypes'
import { useSettingsLocalState } from './useSettingsLocalState'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { ScenarioDomain } from '@configuration/defaultProfile'
import { settingsService } from '@renderer/settings/preferencesService'


const ModelProviderPanel = lazy(() =>
    import('./tabs/ModelProviderPanel').then(m => ({ default: m.ModelProviderPanel })),
)
const AppearanceSettings = lazy(() =>
    import('./tabs/AppearanceSettings').then(m => ({ default: m.AppearanceSettings })),
)
const AgentProfilePanel = lazy(() =>
    import('./tabs/AgentProfilePanel').then(m => ({ default: m.AgentProfilePanel })),
)
const CustomAgentPanel = lazy(() =>
    import('./tabs/CustomAgentPanel').then(m => ({ default: m.CustomAgentPanel })),
)
const SearchEnginePanel = lazy(() =>
    import('./tabs/SearchEnginePanel').then(m => ({ default: m.SearchEnginePanel })),
)
const RulesSettings = lazy(() =>
    import('./tabs/RulesSettings').then(m => ({ default: m.RulesSettings })),
)
const MemorySettings = lazy(() =>
    import('./tabs/MemorySettings').then(m => ({ default: m.MemorySettings })),
)
const SkillRegistryPanel = lazy(() =>
    import('./tabs/SkillRegistryPanel').then(m => ({ default: m.SkillRegistryPanel })),
)
const McpServerPanel = lazy(() =>
    import('./tabs/McpServerPanel'),
)
const EmailServicePanel = lazy(() =>
    import('./tabs/EmailServicePanel'),
)
const SecurityPolicyPanel = lazy(() =>
    import('./tabs/SecurityPolicyPanel').then(m => ({ default: m.SecurityPolicyPanel })),
)
const SystemPreferencesPanel = lazy(() =>
    import('./tabs/SystemPreferencesPanel').then(m => ({ default: m.SystemPreferencesPanel })),
)
const ChannelSettings = lazy(() =>
    import('./tabs/ChannelSettings').then(m => ({ default: m.ChannelSettings })),
)
const PrivacySettingsPanel = lazy(() =>
    import('./tabs/PrivacySettingsPanel').then(m => ({ default: m.PrivacySettingsPanel })),
)
const PerceptionSettingsPanel = lazy(() =>
    import('./tabs/PerceptionSettingsPanel').then(m => ({ default: m.PerceptionSettingsPanel })),
)
const CausalReasoningPanel = lazy(() =>
    import('./tabs/CausalReasoningPanel').then(m => ({ default: m.CausalReasoningPanel })),
)
const IoTSettingsPanel = lazy(() =>
    import('./tabs/IoTSettingsPanel').then(m => ({ default: m.IoTSettingsPanel })),
)
const VoiceSettingsPanel = lazy(() =>
    import('./tabs/VoiceSettingsPanel').then(m => ({ default: m.default })),
)
const VisionSettingsPanel = lazy(() =>
    import('./tabs/VisionSettingsPanel').then(m => ({ default: m.default })),
)
const DesktopControlPanel = lazy(() =>
    import('./tabs/desktop/DesktopControlPanel').then(m => ({ default: m.DesktopControlPanel })),
)
const ProactiveSettingsPanel = lazy(() =>
    import('./tabs/proactive/ProactiveSettingsPanel').then(m => ({ default: m.ProactiveSettingsPanel })),
)
const SceneModeSettingsPanel = lazy(() =>
    import('./tabs/SceneModeSettingsPanel').then(m => ({ default: m.SceneModeSettingsPanel })),
)


function SettingsTabFallback({ language }: { language: Language }) {
    return (
        <div className="min-h-[320px] flex items-center justify-center rounded-2xl border border-border/40 bg-surface/70">
            <div className="flex items-center gap-3 text-sm text-text-muted">
                <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
                <span>{t('settings.loadingSettings', language)}</span>
            </div>
        </div>
    )
}

interface PreferencesDialogProps {
    embedded?: boolean
    pendingNewAgentId?: string
}

/**
 * 用于触发 CustomAgentPanel 自动打开「新建智能体」表单的哨兵 ID。
 * 该 ID 不可能是真实智能体 ID，仅作为意图标记，避免与已保存的智能体冲突。
 */
const NEW_AGENT_TRIGGER_ID = '__create_new_agent__'

export default function PreferencesDialog({ embedded = false, pendingNewAgentId }: PreferencesDialogProps) {
    const {
        state, dispatch, isDirty, handleSave,
        language, setProvider,
        setShowSettings, setShowSettingsPage,
        applyLanguageImmediately,
    } = useSettingsLocalState(embedded)

    // 设置面板打开意图：用于「创建智能体」等入口定位到指定 Tab / 子 Tab
    const settingsIntent = useStore(s => s.settingsIntent)
    const setSettingsIntent = useStore(s => s.setSettingsIntent)

    const [agentSubTab, setAgentSubTab] = useState<'agentConfig' | 'custom'>(
        pendingNewAgentId || settingsIntent?.agentSubTab === 'custom' ? 'custom' : 'agentConfig',
    )

    // 消费打开意图：挂载后立即清空，避免影响下次普通打开设置
    useEffect(() => {
        if (settingsIntent) setSettingsIntent(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])



    const handleNewAgentCreated = useCallback((agentId: string) => {
        if (!agentId || !state.localAgentConfig) return
        const cfg = state.localAgentConfig
        const profiles = cfg.customAgentProfiles || []
        if (profiles.some(p => p.id === agentId)) {
            dispatch({
                type: 'SET_LOCAL_AGENT_CONFIG',
                config: { ...cfg, activeCustomAgentId: agentId },
            })
        }
    }, [state.localAgentConfig, dispatch])

    const storeSet = useStore(useShallow(s => s.set))

    // 新建智能体后自动选中、持久化并关闭
    useEffect(() => {
        if (!pendingNewAgentId) return
        const cfg = state.localAgentConfig
        if (!cfg) return
        const profiles = cfg.customAgentProfiles || []
        const exists = profiles.some(p => p.id === pendingNewAgentId)
        if (exists) {
            const updatedCfg = { ...cfg, activeCustomAgentId: pendingNewAgentId }
            dispatch({
                type: 'SET_LOCAL_AGENT_CONFIG',
                config: updatedCfg,
            })
            storeSet('agentConfig', updatedCfg)
            // 立即持久化到 SQLite，避免重启后丢失
            settingsService.saveSingle('agentConfig', updatedCfg).catch((err) => {
                console.error('[PreferencesDialog] 保存智能体配置失败:', err)
            })
            setTimeout(() => {
                if (embedded) setShowSettingsPage(false)
                else setShowSettings(false)
            }, 100)
        }
    }, [pendingNewAgentId])

    const providers = useMemo(() =>
        Object.entries(PROVIDERS).map(([id, provider]) => ({
            id,
            name: provider.displayName,
            models: [...(provider.models || []), ...(state.localProviderConfigs[id]?.customModels || [])]
        })),
        [state.localProviderConfigs])

    const selectedProvider = useMemo(() =>
        providers.find(provider => provider.id === state.localConfig.provider),
        [state.localConfig.provider, providers])

    const tabs = useMemo(() => [
        { id: 'provider', label: t('settings.provider', language as Language), icon: <Cpu className="w-4 h-4" /> },
        { id: 'agent', label: t('settings.agent', language as Language), icon: <Settings2 className="w-4 h-4" /> },
        { id: 'appearance', label: t('settings.appearance', language as Language), icon: <Palette className="w-4 h-4" /> },
        { id: 'search', label: t('settings.searchEngine', language as Language), icon: <Search className="w-4 h-4" /> },
        { id: 'voice', label: t('settings.voiceSettings', language as Language), icon: <Mic className="w-4 h-4" /> },
        { id: 'vision', label: t('settings.visionSettings', language as Language), icon: <ScanEye className="w-4 h-4" /> },
        { id: 'rules', label: t('settings.rules', language as Language), icon: <FileText className="w-4 h-4" /> },
        { id: 'memory', label: t('settings.memory', language as Language), icon: <Brain className="w-4 h-4" /> },
        { id: 'skills', label: t('settings.skills', language as Language), icon: <Zap className="w-4 h-4" /> },
        { id: 'mcp', label: t('settings.mcp', language as Language), icon: <Plug className="w-4 h-4" /> },
        { id: 'email', label: t('settings.email', language as Language), icon: <Mail className="w-4 h-4" /> },
        { id: 'channel', label: t('settings.channels', language as Language), icon: <Radio className="w-4 h-4" /> },
        { id: 'security', label: t('settings.security', language as Language), icon: <Shield className="w-4 h-4" /> },
        { id: 'privacy', label: t('settings.privacy', language as Language), icon: <Eye className="w-4 h-4" /> },
        { id: 'perception', label: t('settings.perception', language as Language) || '感知预测', icon: <Activity className="w-4 h-4" /> },
        { id: 'causal', label: t('settings.causal', language as Language) || '因果推理', icon: <Network className="w-4 h-4" /> },
        { id: 'iot', label: t('settings.iot', language as Language) || 'IoT 集成', icon: <Cable className="w-4 h-4" /> },
        { id: 'system', label: t('settings.system', language as Language), icon: <Monitor className="w-4 h-4" /> },
        { id: 'desktop', label: t('settings.desktop', language as Language) || '桌面控制', icon: <MonitorSmartphone className="w-4 h-4" /> },
        { id: 'proactive', label: t('settings.proactive', language as Language) || '主动助手', icon: <Sparkles className="w-4 h-4" /> },
        { id: 'sceneMode', label: '场景模式', icon: <Layers className="w-4 h-4" /> },

    ], [language])

    // ── 插件贡献的设置页 Tab（动态加载） ──
    const pluginSettingsTabs = useSyncExternalStore(
        (cb) => pluginUiRegistry.subscribe(cb),
        () => pluginUiRegistry.getSettingsTabs(),
    )

    useEffect(() => {
        pluginUiRegistry.ensureSettingsTabsLoaded()
    }, [])

    const allTabs = useMemo(() => {
        const builtinTabs = tabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            isPlugin: false,
        }))
        const pluginTabs = pluginSettingsTabs.map((pt) => ({
            id: pt.contribution.id,
            label: language === 'zh' ? pt.contribution.labelZh : pt.contribution.label,
            icon: <Puzzle className="w-4 h-4" />,
            isPlugin: true,
        }))
        return [...builtinTabs, ...pluginTabs]
    }, [tabs, pluginSettingsTabs, language])

    const renderActiveTab = () => {
        switch (state.activeTab) {
            case 'provider':
                return (
                    <ModelProviderPanel
                        localConfig={state.localConfig}
                        setLocalConfig={(config) => dispatch({ type: 'SET_LOCAL_CONFIG', config })}
                        localProviderConfigs={state.localProviderConfigs}
                        setLocalProviderConfigs={(configs) => dispatch({ type: 'SET_LOCAL_PROVIDER_CONFIGS', configs })}
                        showApiKey={state.showApiKey}
                        setShowApiKey={(show) => dispatch({ type: 'SET_SHOW_API_KEY', show })}
                        selectedProvider={selectedProvider}
                        providers={providers}
                        language={language}
                        setProvider={setProvider}
                    />
                )
            case 'appearance':
                return (
                    <AppearanceSettings
                        settings={state.editorSettings}
                        setSettings={(settings) => dispatch({ type: 'SET_EDITOR_SETTINGS', settings })}
                        advancedConfig={state.advancedEditorConfig}
                        setAdvancedConfig={(config) => dispatch({ type: 'SET_ADVANCED_EDITOR_CONFIG', config })}
                        language={language}
                        localLanguage={state.localLanguage as Language}
                        setLocalLanguage={(lang) => dispatch({ type: 'SET_LOCAL_LANGUAGE', language: lang })}
                        applyLanguageImmediately={applyLanguageImmediately}
                        agentConfig={state.localAgentConfig}
                        setAgentConfig={(config) => dispatch({ type: 'SET_LOCAL_AGENT_CONFIG', config })}
                    />
                )
            case 'agent': {
                return (
                    <div className="space-y-4 animate-fade-in">
                        <div className="flex items-center gap-1 p-1 bg-surface-active/50 rounded-xl border border-border/40 w-fit">
                            <button
                                onClick={() => setAgentSubTab('agentConfig')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                    agentSubTab === 'agentConfig'
                                        ? 'bg-accent/15 text-accent shadow-sm'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                {t('settings.agentSubTab.agentConfig', language as Language)}
                            </button>
                            <button
                                onClick={() => setAgentSubTab('custom')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                    agentSubTab === 'custom'
                                        ? 'bg-accent/15 text-accent shadow-sm'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                {language === 'zh' ? '自定义智能体' : 'Custom Agents'}
                            </button>
                        </div>
                        {agentSubTab === 'agentConfig' ? (
                            <AgentProfilePanel
                                autoApprove={state.localAutoApprove}
                                setAutoApprove={(value) => dispatch({ type: 'SET_LOCAL_AUTO_APPROVE', value })}
                                aiInstructions={state.localAiInstructions}
                                setAiInstructions={(value) => dispatch({ type: 'SET_LOCAL_AI_INSTRUCTIONS', value })}
                                promptTemplateId={state.localPromptTemplateId}
                                setPromptTemplateId={(value) => dispatch({ type: 'SET_LOCAL_PROMPT_TEMPLATE_ID', value })}
                                agentConfig={state.localAgentConfig}
                                setAgentConfig={(config) => dispatch({ type: 'SET_LOCAL_AGENT_CONFIG', config })}
                                webSearchConfig={state.localWebSearchConfig}
                                setWebSearchConfig={(config) => dispatch({ type: 'SET_LOCAL_WEB_SEARCH_CONFIG', config })}
                                language={language}
                            />
                        ) : (
                            <Suspense fallback={<div className="py-8 text-center text-xs text-text-muted">{t('settings.loadingSettings', language as Language)}</div>}>
                                <CustomAgentPanel
                                    agentConfig={state.localAgentConfig}
                                    setAgentConfig={(config) => dispatch({ type: 'SET_LOCAL_AGENT_CONFIG', config })}
                                    language={language}
                                    onNewAgentCreated={handleNewAgentCreated}
                                    pendingNewAgentId={settingsIntent?.createNewAgent ? NEW_AGENT_TRIGGER_ID : pendingNewAgentId}
                                    editAgentId={settingsIntent?.editAgentId}
                                />
                            </Suspense>
                        )}
                    </div>
                )
            }
            case 'search':
                return (
                    <SearchEnginePanel
                        webSearchConfig={state.localWebSearchConfig}
                        setWebSearchConfig={(config) => dispatch({ type: 'SET_LOCAL_WEB_SEARCH_CONFIG', config })}
                        language={language}
                    />
                )
            case 'rules':
                return <RulesSettings language={language} />
            case 'memory':
                return <MemorySettings language={language} />
            case 'skills':
                return <SkillRegistryPanel language={language} />
            case 'mcp':
                return <McpServerPanel language={language} mcpConfig={state.localMcpConfig} setMcpConfig={(config) => dispatch({ type: 'SET_LOCAL_MCP_CONFIG', config })} />
            case 'email':
                return <EmailServicePanel language={language} emailConfig={state.localEmailConfig} setEmailConfig={(config) => dispatch({ type: 'SET_LOCAL_EMAIL_CONFIG', config })} />
            case 'channel':
                return <ChannelSettings language={language} />
            case 'security':
                return (
                    <SecurityPolicyPanel
                        language={language}
                        securitySettings={state.localSecuritySettings}
                        setSecuritySettings={(settings) => dispatch({ type: 'SET_LOCAL_SECURITY_SETTINGS', settings })}
                        isWorkspaceEditor={false}
                        autoApprove={state.localAutoApprove}
                        setAutoApprove={(value) => dispatch({ type: 'SET_LOCAL_AUTO_APPROVE', value })}
                        agentConfig={state.localAgentConfig}
                        setAgentConfig={(config) => dispatch({ type: 'SET_LOCAL_AGENT_CONFIG', config })}
                    />
                )
            case 'privacy':
                return (
                    <PrivacySettingsPanel
                        language={language}
                        privacySettings={state.localPrivacySettings}
                        setPrivacySettings={(settings) => dispatch({ type: 'SET_LOCAL_PRIVACY_SETTINGS', settings })}
                    />
                )
            case 'perception':
                return <PerceptionSettingsPanel language={language} />
            case 'causal':
                return <CausalReasoningPanel language={language} />
            case 'iot':
                return <IoTSettingsPanel language={language} />
            case 'system':
                return (
                    <SystemPreferencesPanel
                        language={language}
                        enableFileLogging={state.localEnableFileLogging}
                        setEnableFileLogging={(value) => dispatch({ type: 'SET_LOCAL_ENABLE_FILE_LOGGING', value })}
                    />
                )
            case 'voice':
                return <VoiceSettingsPanel language={language} />
            case 'vision':
                return <VisionSettingsPanel language={language} />
            case 'desktop':
                return <DesktopControlPanel language={language} />
            case 'proactive':
                return <ProactiveSettingsPanel language={language} />
            case 'sceneMode':
                return <SceneModeSettingsPanel />
            default: {
                const pluginTab = pluginSettingsTabs.find(pt => pt.contribution.id === state.activeTab)
                if (pluginTab) {
                    const PluginTabComponent = pluginTab.component
                    return <PluginTabComponent host={pluginTab.host} />
                }
                return null
            }
        }
    }

    const requestClose = useCallback(async () => {
        if (state.isClosing) return
        dispatch({ type: 'SET_CLOSING', closing: true })
        if (isDirty) {
            const result = await globalConfirm({
                title: t('settings.confirmTitle', language as Language),
                message: t('settings.unsavedChangesConfirm', language as Language),
                confirmText: t('statusBar.discard', language as Language),
                cancelText: t('statusBar.cancel', language as Language),
                saveText: t('settings.saveChanges', language as Language),
                variant: 'warning',
            })
            if (result === 'save') {
                await handleSave()
            } else if (!result) {
                dispatch({ type: 'SET_CLOSING', closing: false })
                return
            }
        }
        if (embedded) setShowSettingsPage(false)
        else setShowSettings(false)
        dispatch({ type: 'SET_CLOSING', closing: false })
    }, [state.isClosing, isDirty, language, setShowSettings, setShowSettingsPage, embedded, handleSave, dispatch])

    const handleClose = useCallback(() => {
        void requestClose()
    }, [requestClose])

    const dialogContent = (
        <div className={`flex h-full w-full relative ${embedded ? '' : 'max-h-[800px]'}`}>
            <div className={`bg-surface/30 backdrop-blur-xl flex flex-col pb-6 border-r border-border/40 shadow-xl shadow-black/10 ${embedded ? 'w-56 pt-10' : 'w-64 pt-8'}`}>
                {embedded && (
                    <div className="px-4 mb-4">
                        <button
                            onClick={handleClose}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-transparent hover:border-border/40 transition-all duration-200 group"
                            title={t('settings.backToApp', language as Language) || t('settings.closeSettings', language as Language)}
                        >
                            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-200" />
                            <span>{t('settings.backToApp', language as Language) || '返回'}</span>
                        </button>
                    </div>
                )}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    {allTabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: tab.id as SettingsTab })}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${state.activeTab === tab.id ? 'bg-accent/10 text-text-primary border border-accent/20' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'}`}
                        >
                            <span className={`transition-colors duration-200 ${state.activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                                {tab.icon}
                            </span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </nav>
            </div>
            <div className="flex-1 flex justify-center overflow-hidden">
                <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
                    <div className={`shrink-0 px-8 pb-4 border-b border-border/40 flex items-center ${embedded ? 'pt-10 drag-region' : 'pt-6 justify-between'}`}>
                        <div className="no-drag">
                            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                                {allTabs.find(tab => tab.id === state.activeTab)?.label}
                            </h3>
                            <p className="text-sm text-text-muted mt-1.5 opacity-80">
                                {t('settings.managePreferences', language as Language)}
                            </p>
                        </div>
                        {!embedded && (
                            <button
                                onClick={handleClose}
                                className="no-drag p-2.5 rounded-xl hover:bg-red-500/10 text-text-muted hover:text-red-500 border border-transparent hover:border-red-500/30 transition-all duration-200 group"
                                title={t('settings.closeSettings', language as Language)}
                            >
                                <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                            </button>
                        )}
                    </div>
                    <div className="settings-scroll-region flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-28">
                        <div className="settings-tab-panel space-y-6">
                            <Suspense fallback={<SettingsTabFallback language={language as Language} />}>
                                {renderActiveTab()}
                            </Suspense>
                        </div>
                    </div>
                    {isDirty && state.activeTab !== 'channel' && state.activeTab !== 'voice' && state.activeTab !== 'vision' && (
                        <div className="absolute bottom-6 right-8 left-8 p-4 rounded-xl bg-surface/95 border border-border/60 shadow-lg flex items-center justify-between z-10 transition-all duration-300">
                            <span className="text-xs text-text-muted ml-2 font-medium">
                                {t('settings.unsavedChanges', language as Language)}
                            </span>
                            <div className="flex items-center gap-3">
                                <ActionButton variant="ghost" onClick={handleClose} className="hover:bg-text-primary/[0.05] text-text-secondary rounded-lg">
                                    {t('settings.backToApp', language as Language)}
                                </ActionButton>
                                <ActionButton
                                    variant="primary"
                                    onClick={handleSave}
                                    className="min-w-[140px] shadow-lg transition-all duration-300 rounded-xl bg-accent hover:bg-accent-hover text-white shadow-accent/20"
                                >
                                    <span className="font-bold">{t('common.save', language as Language)}</span>
                                </ActionButton>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    if (embedded) {
        return dialogContent
    }

    return (
        <OverlayDialog isOpen={true} onClose={handleClose} title="" size="5xl" noPadding showCloseButton={false} className="overflow-hidden bg-background/80 backdrop-blur-2xl border border-border/50 shadow-2xl shadow-black/20 rounded-3xl">
            {dialogContent}
        </OverlayDialog>
    )
}


/* 场景感知设置面板策略                                              */
/* ------------------------------------------------------------------ */

/** 场景设置面板策略 */
export interface ScenarioSettingsPanelPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 可见设置标签页 */
  visibleTabs: string[]
  /** 隐藏设置标签页 */
  hiddenTabs: string[]
  /** 是否显示场景过滤 */
  showScenarioFilter: boolean
  /** 是否显示外观设置 */
  showAppearanceSettings: boolean
  /** 是否显示渠道设置 */
  showChannelSettings: boolean
  /** 是否显示云设置 */
  showCloudSettings: boolean
  /** 是否显示合规设置 */
  showComplianceSettings: boolean
  /** 是否禁用某些设置（只读模式） */
  readonlyMode: boolean
  /** 禁用的设置项 */
  disabledSettings: string[]
}

/** 场景设置面板策略预设 */
const SCENARIO_SETTINGS_PANEL_POLICIES: Record<ScenarioDomain, ScenarioSettingsPanelPolicy> = {
  /** 法律场景：显示合规设置，隐藏渠道设置，只读模式 */
  legal: {
    domain: 'legal',
    visibleTabs: ['model', 'agent', 'security', 'compliance', 'memory', 'rules'],
    hiddenTabs: ['channel', 'cloud', 'appearance'],
    showScenarioFilter: true,
    showAppearanceSettings: false,
    showChannelSettings: false,
    showCloudSettings: false,
    showComplianceSettings: true,
    readonlyMode: false,
    disabledSettings: ['security.strictWorkspaceMode', 'security.enablePermissionConfirm'],
  },

  /** 医疗场景：显示合规设置，隐藏渠道和云设置，部分只读 */
  medical: {
    domain: 'medical',
    visibleTabs: ['model', 'agent', 'security', 'compliance', 'memory'],
    hiddenTabs: ['channel', 'cloud', 'appearance', 'rules'],
    showScenarioFilter: true,
    showAppearanceSettings: false,
    showChannelSettings: false,
    showCloudSettings: false,
    showComplianceSettings: true,
    readonlyMode: true,
    disabledSettings: [
      'security.strictWorkspaceMode',
      'security.enablePermissionConfirm',
      'agent.enableAutoFix',
      'agent.allowDelete',
    ],
  },

  /** 教育场景：显示所有设置，无限制 */
  education: {
    domain: 'education',
    visibleTabs: [],
    hiddenTabs: [],
    showScenarioFilter: true,
    showAppearanceSettings: true,
    showChannelSettings: true,
    showCloudSettings: true,
    showComplianceSettings: false,
    readonlyMode: false,
    disabledSettings: [],
  },

  /** 通用场景：显示所有设置 */
  general: {
    domain: 'general',
    visibleTabs: [],
    hiddenTabs: [],
    showScenarioFilter: false,
    showAppearanceSettings: true,
    showChannelSettings: true,
    showCloudSettings: true,
    showComplianceSettings: false,
    readonlyMode: false,
    disabledSettings: [],
  },
}

/**
 * 获取场景设置面板策略
 */
export function getScenarioSettingsPanelPolicy(
  domain: ScenarioDomain,
): ScenarioSettingsPanelPolicy {
  return SCENARIO_SETTINGS_PANEL_POLICIES[domain]
}

/**
 * 检查设置标签页是否可见
 */
export function isTabVisible(tabId: string, domain: ScenarioDomain): boolean {
  const policy = SCENARIO_SETTINGS_PANEL_POLICIES[domain]
  if (policy.hiddenTabs.includes(tabId)) return false
  if (policy.visibleTabs.length === 0) return true
  return policy.visibleTabs.includes(tabId)
}

/**
 * 检查设置项是否被禁用
 */
export function isSettingDisabled(settingKey: string, domain: ScenarioDomain): boolean {
  const policy = SCENARIO_SETTINGS_PANEL_POLICIES[domain]
  return policy.disabledSettings.includes(settingKey)
}