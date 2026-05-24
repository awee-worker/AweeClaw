import { lazy, Suspense, useState, useEffect, useMemo, useCallback } from 'react'
import { Cpu, Settings2, Code, Keyboard, Database, Shield, Monitor, Globe, Plug, Braces, Brain, FileCode, FileText, Zap, Check, X, Palette, Radio, Cloud } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { PROVIDERS } from '@configuration/aiProviders'
import { BRAND } from '@shared/brand'
import stableStringify from 'fast-json-stable-stringify'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { invalidateAgentConfigCache } from '@intelligence/utils/intelligenceConfig'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { ActionButton, OverlayDialog } from '@components/ui'
import { SettingsTab, EditorSettingsState } from './preferencesTypes'

const ModelProviderPanel = lazy(() =>
    import('./tabs/ModelProviderPanel').then(module => ({ default: module.ModelProviderPanel })),
)
const EditorPreferencesPanel = lazy(() =>
    import('./tabs/EditorPreferencesPanel').then(module => ({ default: module.EditorPreferencesPanel })),
)
const LanguageSettings = lazy(() =>
    import('./tabs/LanguageSettings').then(module => ({ default: module.LanguageSettings })),
)
const AppearanceSettings = lazy(() =>
    import('./tabs/AppearanceSettings').then(module => ({ default: module.AppearanceSettings })),
)
const SnippetLibraryPanel = lazy(() =>
    import('./tabs/SnippetLibraryPanel').then(module => ({ default: module.SnippetLibraryPanel })),
)
const AgentProfilePanel = lazy(() =>
    import('./tabs/AgentProfilePanel').then(module => ({ default: module.AgentProfilePanel })),
)
const RulesSettings = lazy(() =>
    import('./tabs/RulesSettings').then(module => ({ default: module.RulesSettings })),
)
const MemorySettings = lazy(() =>
    import('./tabs/MemorySettings').then(module => ({ default: module.MemorySettings })),
)
const SkillRegistryPanel = lazy(() =>
    import('./tabs/SkillRegistryPanel').then(module => ({ default: module.SkillRegistryPanel })),
)
const McpServerPanel = lazy(() =>
    import('./tabs/McpServerPanel'),
)
const LanguageServicePanel = lazy(() =>
    import('./tabs/LanguageServicePanel').then(module => ({ default: module.LanguageServicePanel })),
)
const KeybindingPanel = lazy(() =>
    import('@components/dock-panels/ShortcutPanel'),
)
const IndexingPreferencesPanel = lazy(() =>
    import('./tabs/IndexingPreferencesPanel').then(module => ({ default: module.IndexingPreferencesPanel })),
)
const SecurityPolicyPanel = lazy(() =>
    import('./tabs/SecurityPolicyPanel').then(module => ({ default: module.SecurityPolicyPanel })),
)
const SystemPreferencesPanel = lazy(() =>
    import('./tabs/SystemPreferencesPanel').then(module => ({ default: module.SystemPreferencesPanel })),
)
const ChannelSettings = lazy(() =>
    import('./tabs/ChannelSettings').then(module => ({ default: module.ChannelSettings })),
)
const CloudSettings = lazy(() =>
    import('./tabs/CloudSettings').then(module => ({ default: module.CloudSettings })),
)

function serializeComparable(value: unknown): string {
    return stableStringify(value) ?? ''
}

function toEditorSettingsState(config: ReturnType<typeof getEditorConfig>): EditorSettingsState {
    return {
        fontSize: config.fontSize,
        chatFontSize: config.chatFontSize ?? config.fontSize,
        tabSize: config.tabSize,
        wordWrap: config.wordWrap,
        lineNumbers: config.lineNumbers,
        minimap: config.minimap,
        bracketPairColorization: config.bracketPairColorization,
        formatOnSave: config.formatOnSave,
        autoSave: config.autoSave,
        autoSaveDelay: config.autoSaveDelay,
        theme: BRAND.defaultTheme,
        completionEnabled: config.ai.completionEnabled,
        completionDebounceMs: config.performance.completionDebounceMs,
        completionMaxTokens: config.ai.completionMaxTokens,
        completionTriggerChars: config.ai.completionTriggerChars,
        terminalScrollback: config.terminal.scrollback,
        terminalMaxOutputLines: config.terminal.maxOutputLines,
        lspTimeoutMs: config.lsp.timeoutMs,
        lspCompletionTimeoutMs: config.lsp.completionTimeoutMs,
        largeFileWarningThresholdMB: config.performance.largeFileWarningThresholdMB,
        largeFileLineCount: config.performance.largeFileLineCount,
        commandTimeoutMs: config.performance.commandTimeoutMs,
        workerTimeoutMs: config.performance.workerTimeoutMs,
        healthCheckTimeoutMs: config.performance.healthCheckTimeoutMs,
        maxProjectFiles: config.performance.maxProjectFiles,
        maxFileTreeDepth: config.performance.maxFileTreeDepth,
        maxSearchResults: config.performance.maxSearchResults,
        saveDebounceMs: config.performance.saveDebounceMs,
        flushIntervalMs: config.performance.flushIntervalMs,
    }
}

function SettingsTabFallback({ language }: { language: Language }) {
    return (
        <div className="min-h-[320px] flex items-center justify-center rounded-2xl border border-border/40 bg-surface/70">
            <div className="flex items-center gap-3 text-sm text-text-muted">
                <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
                <span>{language === 'zh' ? '正在加载设置项...' : 'ProgressIndicator settings...'}</span>
            </div>
        </div>
    )
}

interface PreferencesDialogProps {
    embedded?: boolean
}

export default function PreferencesDialog({ embedded = false }: PreferencesDialogProps) {
    const {
        llmConfig,
        language,
        autoApprove,
        providerConfigs,
        promptTemplateId,
        agentConfig,
        aiInstructions,
        webSearchConfig,
        mcpConfig,
        enableFileLogging,
        editorConfig,
        securitySettings,
        set,
        setProvider,
        setShowSettings,
        setShowSettingsPage,
        settingsInitialTab,
        save,
        activeScenarioId,
    } = useStore(useShallow(s => ({
        llmConfig: s.llmConfig,
        language: s.language,
        autoApprove: s.autoApprove,
        providerConfigs: s.providerConfigs,
        promptTemplateId: s.promptTemplateId,
        agentConfig: s.agentConfig,
        aiInstructions: s.aiInstructions,
        webSearchConfig: s.webSearchConfig,
        mcpConfig: s.mcpConfig,
        enableFileLogging: s.enableFileLogging,
        editorConfig: s.editorConfig,
        securitySettings: s.securitySettings,
        set: s.set,
        setProvider: s.setProvider,
        setShowSettings: s.setShowSettings,
        setShowSettingsPage: s.setShowSettingsPage,
        settingsInitialTab: s.settingsInitialTab,
        save: s.save,
        activeScenarioId: s.activeScenarioId,
    })))

    const [activeTab, setActiveTab] = useState<SettingsTab>('provider')
    const [showApiKey, setShowApiKey] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        if (settingsInitialTab) {
            setActiveTab(settingsInitialTab as SettingsTab)
        }
    }, [settingsInitialTab])

    useEffect(() => {
        const codeEditorOnlyTabs = new Set(['editor', 'snippets', 'indexing', 'lsp', 'keybindings'])
        if (activeScenarioId !== 'workspace-editor' && codeEditorOnlyTabs.has(activeTab)) {
            setActiveTab('provider')
        }
    }, [activeScenarioId, activeTab])

    const [localConfig, setLocalConfig] = useState(llmConfig)
    const [localLanguage, setLocalLanguage] = useState(language)
    const [localAutoApprove, setLocalAutoApprove] = useState(autoApprove)
    const [localPromptTemplateId, setLocalPromptTemplateId] = useState(promptTemplateId)
    const [localAgentConfig, setLocalAgentConfig] = useState(agentConfig)
    const [localProviderConfigs, setLocalProviderConfigs] = useState(providerConfigs)
    const [localAiInstructions, setLocalAiInstructions] = useState(aiInstructions)
    const [localWebSearchConfig, setLocalWebSearchConfig] = useState(webSearchConfig)
    const [localMcpConfig, setLocalMcpConfig] = useState(mcpConfig)
    const [localEnableFileLogging, setLocalEnableFileLogging] = useState(enableFileLogging)
    const [localSecuritySettings, setLocalSecuritySettings] = useState(securitySettings)
    const [editorSettings, setEditorSettings] = useState<EditorSettingsState>(() => toEditorSettingsState(editorConfig))
    const [advancedEditorConfig, setAdvancedEditorConfig] = useState(editorConfig)
    const [isClosing, setIsClosing] = useState(false)

    useEffect(() => {
        setLocalConfig(llmConfig)
        setLocalLanguage(language)
        setLocalAutoApprove(autoApprove)
        setLocalPromptTemplateId(promptTemplateId)
        setLocalAgentConfig(agentConfig)
        setLocalProviderConfigs(providerConfigs)
        setLocalAiInstructions(aiInstructions)
        setLocalWebSearchConfig(webSearchConfig)
        setLocalMcpConfig(mcpConfig)
        setLocalEnableFileLogging(enableFileLogging)
        setLocalSecuritySettings(securitySettings)
        setEditorSettings(toEditorSettingsState(editorConfig))
        setAdvancedEditorConfig(editorConfig)
    }, [
        agentConfig,
        aiInstructions,
        autoApprove,
        editorConfig,
        enableFileLogging,
        language,
        llmConfig,
        mcpConfig,
        promptTemplateId,
        providerConfigs,
        securitySettings,
        webSearchConfig,
    ])

    const finalEditorConfig = useMemo(() => ({
        ...advancedEditorConfig,
        fontSize: editorSettings.fontSize,
        chatFontSize: editorSettings.chatFontSize,
        tabSize: editorSettings.tabSize,
        wordWrap: editorSettings.wordWrap,
        lineNumbers: editorSettings.lineNumbers,
        minimap: editorSettings.minimap,
        bracketPairColorization: editorSettings.bracketPairColorization,
        formatOnSave: editorSettings.formatOnSave,
        autoSave: editorSettings.autoSave,
        autoSaveDelay: editorSettings.autoSaveDelay,
        ai: {
            ...advancedEditorConfig.ai,
            completionEnabled: editorSettings.completionEnabled,
            completionMaxTokens: editorSettings.completionMaxTokens,
            completionTriggerChars: editorSettings.completionTriggerChars,
        },
        terminal: {
            ...advancedEditorConfig.terminal,
            scrollback: editorSettings.terminalScrollback,
            maxOutputLines: editorSettings.terminalMaxOutputLines,
        },
        lsp: {
            ...advancedEditorConfig.lsp,
            timeoutMs: editorSettings.lspTimeoutMs,
            completionTimeoutMs: editorSettings.lspCompletionTimeoutMs,
        },
        performance: {
            ...advancedEditorConfig.performance,
            completionDebounceMs: editorSettings.completionDebounceMs,
            largeFileWarningThresholdMB: editorSettings.largeFileWarningThresholdMB,
            largeFileLineCount: editorSettings.largeFileLineCount,
            commandTimeoutMs: editorSettings.commandTimeoutMs,
            workerTimeoutMs: editorSettings.workerTimeoutMs,
            healthCheckTimeoutMs: editorSettings.healthCheckTimeoutMs,
            maxProjectFiles: editorSettings.maxProjectFiles,
            maxFileTreeDepth: editorSettings.maxFileTreeDepth,
            maxSearchResults: editorSettings.maxSearchResults,
            saveDebounceMs: editorSettings.saveDebounceMs,
            flushIntervalMs: editorSettings.flushIntervalMs,
        },
    }), [advancedEditorConfig, editorSettings])

    const sourceSnapshots = useMemo(() => ({
        llmConfig: serializeComparable(llmConfig),
        agentConfig: serializeComparable(agentConfig),
        webSearchConfig: serializeComparable(webSearchConfig),
        mcpConfig: serializeComparable(mcpConfig),
        providerConfigs: serializeComparable(providerConfigs),
        securitySettings: serializeComparable(securitySettings),
        editorConfig: serializeComparable(editorConfig),
    }), [agentConfig, editorConfig, llmConfig, mcpConfig, providerConfigs, securitySettings, webSearchConfig])

    const localSnapshots = useMemo(() => ({
        llmConfig: serializeComparable(localConfig),
        agentConfig: serializeComparable(localAgentConfig),
        webSearchConfig: serializeComparable(localWebSearchConfig),
        mcpConfig: serializeComparable(localMcpConfig),
        providerConfigs: serializeComparable(localProviderConfigs),
        securitySettings: serializeComparable(localSecuritySettings),
        editorConfig: serializeComparable(finalEditorConfig),
    }), [finalEditorConfig, localAgentConfig, localConfig, localMcpConfig, localProviderConfigs, localSecuritySettings, localWebSearchConfig])

    const isDirty = useMemo(() => {
        return localSnapshots.llmConfig !== sourceSnapshots.llmConfig ||
            localLanguage !== language ||
            localAutoApprove !== autoApprove ||
            localPromptTemplateId !== promptTemplateId ||
            localSnapshots.agentConfig !== sourceSnapshots.agentConfig ||
            localAiInstructions !== aiInstructions ||
            localSnapshots.webSearchConfig !== sourceSnapshots.webSearchConfig ||
            localSnapshots.mcpConfig !== sourceSnapshots.mcpConfig ||
            localEnableFileLogging !== enableFileLogging ||
            localSnapshots.providerConfigs !== sourceSnapshots.providerConfigs ||
            localSnapshots.securitySettings !== sourceSnapshots.securitySettings ||
            localSnapshots.editorConfig !== sourceSnapshots.editorConfig
    }, [aiInstructions, autoApprove, enableFileLogging, language, localAiInstructions, localAutoApprove, localEnableFileLogging, localLanguage, localPromptTemplateId, localSnapshots, promptTemplateId, sourceSnapshots])

    const handleSave = useCallback(async () => {
        if (!isDirty) {
            return
        }

        const currentProvider = localConfig.provider
        const providerExists = localProviderConfigs[currentProvider] !== undefined || !!PROVIDERS[currentProvider]

        const finalProviderConfigs = providerExists
            ? {
                ...localProviderConfigs,
                [currentProvider]: {
                    ...localProviderConfigs[currentProvider],
                    apiKey: localConfig.apiKey,
                    baseUrl: localConfig.baseUrl,
                    timeout: localConfig.timeout,
                    model: localConfig.model,
                    headers: localConfig.headers,
                    openAICompatibilityProfile: localConfig.openAICompatibilityProfile,
                    protocol: localConfig.protocol,
                }
            }
            : { ...localProviderConfigs }

        try {
            set('llmConfig', localConfig)
            set('language', localLanguage)
            set('autoApprove', localAutoApprove)
            set('promptTemplateId', localPromptTemplateId)
            set('agentConfig', localAgentConfig)
            invalidateAgentConfigCache()
            set('aiInstructions', localAiInstructions)
            set('webSearchConfig', localWebSearchConfig)
            set('mcpConfig', localMcpConfig)
            set('enableFileLogging', localEnableFileLogging)
            set('securitySettings', localSecuritySettings)
            set('providerConfigs', finalProviderConfigs)
            set('editorConfig', finalEditorConfig)

            await save()

            try {
                window.electronAPI?.setLanguage?.(localLanguage);
            } catch (e) {
                console.error('语言同步失败:', e)
            }


            if (localWebSearchConfig.googleApiKey && localWebSearchConfig.googleCx) {
                window.electronAPI?.httpSetGoogleSearch?.(localWebSearchConfig.googleApiKey, localWebSearchConfig.googleCx)
            }

            window.electronAPI?.mcpSetAutoConnect?.(localMcpConfig.autoConnect ?? true)

            setSaved(true)
            window.setTimeout(() => setSaved(false), 2000)
            toast.success(t('success.settingsSaved', localLanguage as Language))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
        }
    }, [
        finalEditorConfig,
        isDirty,
        localAgentConfig,
        localAiInstructions,
        localAutoApprove,
        localConfig,
        localEnableFileLogging,
        localLanguage,
        localMcpConfig,
        localPromptTemplateId,
        localProviderConfigs,
        localSecuritySettings,
        localWebSearchConfig,
        save,
        set,
    ])

    const requestClose = useCallback(async () => {
        if (isClosing) {
            return
        }

        setIsClosing(true)

        if (isDirty) {
            const confirmed = await globalConfirm({
                title: t('settings', language as Language),
                message: t('unsavedChangesConfirm', language as Language),
                confirmText: t('discard', language as Language),
                cancelText: t('cancel', language as Language),
                variant: 'warning',
            })
            if (!confirmed) {
                setIsClosing(false)
                return
            }
        }

        if (embedded) {
            setShowSettingsPage(false)
        } else {
            setShowSettings(false)
        }
        setIsClosing(false)
    }, [isClosing, isDirty, language, setShowSettings, setShowSettingsPage, embedded])

    const handleClose = useCallback(() => {
        void requestClose()
    }, [requestClose])

    const providers = useMemo(() =>
        Object.entries(PROVIDERS).map(([id, provider]) => ({
            id,
            name: provider.displayName,
            models: [...(provider.models || []), ...(localProviderConfigs[id]?.customModels || [])]
        })),
        [localProviderConfigs])

    const selectedProvider = useMemo(() =>
        providers.find(provider => provider.id === localConfig.provider),
        [localConfig.provider, providers])

    const isWorkspaceEditor = activeScenarioId === 'workspace-editor'
    const codeEditorOnlyTabs = new Set(['editor', 'snippets', 'indexing', 'lsp', 'keybindings'])

    const tabs = useMemo(() => {
        const allTabs = [
            { id: 'provider', label: language === 'zh' ? '模型设置' : 'Model', icon: <Cpu className="w-4 h-4" /> },
            { id: 'language', label: language === 'zh' ? '语言设置' : 'Language', icon: <Globe className="w-4 h-4" /> },
            { id: 'appearance', label: language === 'zh' ? '外观设置' : 'Appearance', icon: <Palette className="w-4 h-4" /> },
            { id: 'agent', label: language === 'zh' ? '智能体' : 'Agent', icon: <Settings2 className="w-4 h-4" /> },
            { id: 'rules', label: language === 'zh' ? '行为规则' : 'Rules', icon: <FileText className="w-4 h-4" /> },
            { id: 'memory', label: language === 'zh' ? '上下文记忆' : 'Memory', icon: <Brain className="w-4 h-4" /> },
            { id: 'skills', label: language === 'zh' ? 'Skills技能' : 'Skills', icon: <Zap className="w-4 h-4" /> },
            { id: 'mcp', label: language === 'zh' ? 'MCP服务' : 'MCP', icon: <Plug className="w-4 h-4" /> },
            { id: 'channel', label: language === 'zh' ? '多渠道' : 'Channels', icon: <Radio className="w-4 h-4" /> },
            { id: 'editor', label: language === 'zh' ? '编辑器' : 'Editor', icon: <Code className="w-4 h-4" /> },
            { id: 'snippets', label: language === 'zh' ? '代码片段' : 'Snippets', icon: <FileCode className="w-4 h-4" /> },
            { id: 'indexing', label: language === 'zh' ? '代码索引' : 'Indexing', icon: <Database className="w-4 h-4" /> },
            { id: 'lsp', label: language === 'zh' ? '语言服务' : 'LSP', icon: <Braces className="w-4 h-4" /> },
            { id: 'keybindings', label: language === 'zh' ? '快捷键' : 'Keybindings', icon: <Keyboard className="w-4 h-4" /> },
            { id: 'security', label: language === 'zh' ? '安全设置' : 'Security', icon: <Shield className="w-4 h-4" /> },
            { id: 'system', label: language === 'zh' ? '系统设置' : 'System', icon: <Monitor className="w-4 h-4" /> },
            { id: 'cloud', label: language === 'zh' ? '云端服务' : 'Cloud', icon: <Cloud className="w-4 h-4" /> },
        ]
        if (isWorkspaceEditor) return allTabs
        return allTabs.filter(tab => !codeEditorOnlyTabs.has(tab.id))
    }, [language, isWorkspaceEditor])

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'language':
                return (
                    <LanguageSettings
                        language={language as Language}
                        localLanguage={localLanguage as Language}
                        setLocalLanguage={(lang) => setLocalLanguage(lang)}
                    />
                )
            case 'provider':
                return (
                    <ModelProviderPanel
                        localConfig={localConfig}
                        setLocalConfig={setLocalConfig}
                        localProviderConfigs={localProviderConfigs}
                        setLocalProviderConfigs={setLocalProviderConfigs}
                        showApiKey={showApiKey}
                        setShowApiKey={setShowApiKey}
                        selectedProvider={selectedProvider}
                        providers={providers}
                        language={language}
                        setProvider={setProvider}
                    />
                )
            case 'appearance':
                return (
                    <AppearanceSettings
                        settings={editorSettings}
                        setSettings={setEditorSettings}
                        advancedConfig={advancedEditorConfig}
                        setAdvancedConfig={setAdvancedEditorConfig}
                        language={language}
                    />
                )
            case 'editor':
                return (
                    <EditorPreferencesPanel
                        settings={editorSettings}
                        setSettings={setEditorSettings}
                        advancedConfig={advancedEditorConfig}
                        setAdvancedConfig={setAdvancedEditorConfig}
                        language={language}
                    />
                )
            case 'snippets':
                return <SnippetLibraryPanel language={language} />
            case 'agent':
                return (
                    <AgentProfilePanel
                        autoApprove={localAutoApprove}
                        setAutoApprove={setLocalAutoApprove}
                        aiInstructions={localAiInstructions}
                        setAiInstructions={setLocalAiInstructions}
                        promptTemplateId={localPromptTemplateId}
                        setPromptTemplateId={setLocalPromptTemplateId}
                        agentConfig={localAgentConfig}
                        setAgentConfig={setLocalAgentConfig}
                        webSearchConfig={localWebSearchConfig}
                        setWebSearchConfig={setLocalWebSearchConfig}
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
                return <McpServerPanel language={language} mcpConfig={localMcpConfig} setMcpConfig={setLocalMcpConfig} />
            case 'channel':
                return <ChannelSettings language={language} />
            case 'lsp':
                return <LanguageServicePanel language={language} />
            case 'keybindings':
                return <KeybindingPanel />
            case 'indexing':
                return <IndexingPreferencesPanel language={language} />
            case 'security':
                return (
                    <SecurityPolicyPanel
                        language={language}
                        securitySettings={localSecuritySettings}
                        setSecuritySettings={setLocalSecuritySettings}
                        isWorkspaceEditor={isWorkspaceEditor}
                    />
                )
            case 'system':
                return (
                    <SystemPreferencesPanel
                        language={language}
                        enableFileLogging={localEnableFileLogging}
                        setEnableFileLogging={setLocalEnableFileLogging}
                    />
                )
            case 'cloud':
                return <CloudSettings language={language} />
            default:
                return null
        }
    }

    const dialogContent = (
        <div className={`flex h-full ${embedded ? '' : 'max-h-[800px]'}`}>
            <div className={`bg-surface/30 backdrop-blur-xl flex flex-col pt-8 pb-6 ${embedded ? 'w-56' : 'w-64'}`}>
                <div className="px-6 mb-6">
                    <h2 className="text-lg font-semibold text-text-primary tracking-tight flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
                            <Settings2 className="w-5 h-5 text-accent" />
                        </div>
                        {language === 'zh' ? '设置' : 'Settings'}
                    </h2>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as SettingsTab)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${activeTab === tab.id ? 'bg-accent/10 text-text-primary border border-accent/20' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'}`}
                        >
                            <span className={`transition-colors duration-200 ${activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                                {tab.icon}
                            </span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </nav>
            </div>

            <div className="flex-1 flex justify-center overflow-hidden">
                <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
                <div className="shrink-0 px-8 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
                    <div>
                        <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                            {tabs.find(tab => tab.id === activeTab)?.label}
                        </h3>
                        <p className="text-sm text-text-muted mt-1.5 opacity-80">
                            {t('settings.managePreferences', language as Language)}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group"
                        title={language === 'zh' ? '关闭设置' : 'Close settings'}
                    >
                        <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                    </button>
                </div>

                <div className="settings-scroll-region flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-28">
                    <div className="settings-tab-panel space-y-6">
                        <Suspense fallback={<SettingsTabFallback language={language as Language} />}>
                            {renderActiveTab()}
                        </Suspense>
                    </div>
                </div>

                {(isDirty || saved) && (
                    <div className="absolute bottom-6 right-8 left-8 p-4 rounded-xl bg-surface/95 border border-border/60 shadow-lg flex items-center justify-between z-10 transition-all duration-300">
                        <span className="text-xs text-text-muted ml-2 font-medium">
                            {saved && !isDirty
                                ? t('settings.allChangesSaved', language as Language)
                                : t('settings.unsavedChanges', language as Language)}
                        </span>
                        <div className="flex items-center gap-3">
                            <ActionButton variant="ghost" onClick={handleClose} className="hover:bg-text-inverted/[0.05] hover:bg-text-primary/[0.05] text-text-secondary rounded-lg">
                                {t('cancel', language as Language)}
                            </ActionButton>
                            <ActionButton
                                variant={saved ? 'success' : 'primary'}
                                onClick={handleSave}
                                disabled={!isDirty}
                                className={`min-w-[140px] shadow-lg transition-all duration-300 rounded-xl ${saved ? 'bg-status-success hover:bg-status-success/90 text-white' : 'bg-accent hover:bg-accent-hover text-white shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                            >
                                {saved ? (
                                    <span className="flex items-center gap-2 justify-center font-bold">
                                        <Check className="w-4 h-4" />
                                        {t('saved', language as Language)}
                                    </span>
                                ) : (
                                    <span className="font-bold">{t('settings.saveChanges', language as Language)}</span>
                                )}
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
