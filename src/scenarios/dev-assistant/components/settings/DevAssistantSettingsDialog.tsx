/**
 * 开发助手场景专属设置对话框
 *
 * 包含：编辑器设置、代码片段、索引、语言服务(LSP)、快捷键
 * 独立于全局 PreferencesDialog，仅管理开发助手场景相关配置
 */

import { lazy, Suspense, useCallback } from 'react'
import { Code, Keyboard, Database, Braces, FileCode, X, Settings2 } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { ActionButton, OverlayDialog } from '@components/ui'
import { useDevAssistantSettings } from './useDevAssistantSettings'

const EditorPreferencesPanel = lazy(() =>
    import('./tabs/EditorPreferencesPanel').then(m => ({ default: m.EditorPreferencesPanel }))
)
const SnippetLibraryPanel = lazy(() =>
    import('./tabs/SnippetLibraryPanel').then(m => ({ default: m.SnippetLibraryPanel }))
)
const IndexingPreferencesPanel = lazy(() =>
    import('./tabs/IndexingPreferencesPanel').then(m => ({ default: m.IndexingPreferencesPanel }))
)
const LanguageServicePanel = lazy(() =>
    import('./tabs/LanguageServicePanel').then(m => ({ default: m.LanguageServicePanel }))
)
const KeybindingPanel = lazy(() =>
    import('./tabs/KeybindingPanel')
)

type DevAssistantSettingsTab = 'editor' | 'snippets' | 'indexing' | 'lsp' | 'keybindings'

const TABS: { id: DevAssistantSettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'editor', label: 'settings.editor', icon: <Code className="w-4 h-4" /> },
    { id: 'snippets', label: 'settings.snippets', icon: <FileCode className="w-4 h-4" /> },
    { id: 'indexing', label: 'settings.indexing', icon: <Database className="w-4 h-4" /> },
    { id: 'lsp', label: 'settings.lsp', icon: <Braces className="w-4 h-4" /> },
    { id: 'keybindings', label: 'settings.keybindings', icon: <Keyboard className="w-4 h-4" /> },
]

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

interface DevAssistantSettingsDialogProps {
    embedded?: boolean
    onClose?: () => void
}

export default function DevAssistantSettingsDialog({ embedded = false, onClose }: DevAssistantSettingsDialogProps) {
    const {
        state,
        setActiveTab,
        setEditorSettings,
        setAdvancedConfig,
        isDirty,
        handleSave,
        language,
    } = useDevAssistantSettings()

    const lang = language as Language

    const handleClose = useCallback(async () => {
        if (isDirty) {
            await handleSave()
        }
        onClose?.()
    }, [isDirty, handleSave, onClose])

    const renderTab = () => {
        switch (state.activeTab) {
            case 'editor':
                return (
                    <EditorPreferencesPanel
                        settings={state.editorSettings}
                        setSettings={setEditorSettings}
                        advancedConfig={state.advancedEditorConfig}
                        setAdvancedConfig={setAdvancedConfig}
                        language={language}
                    />
                )
            case 'snippets':
                return <SnippetLibraryPanel language={language} />
            case 'indexing':
                return <IndexingPreferencesPanel language={language} />
            case 'lsp':
                return <LanguageServicePanel language={language} />
            case 'keybindings':
                return <KeybindingPanel />
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
                        {t('settings.devAssistantSettings', lang)}
                    </h2>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${state.activeTab === tab.id ? 'bg-accent/10 text-text-primary border border-accent/20' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'}`}
                        >
                            <span className={`transition-colors duration-200 ${state.activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                                {tab.icon}
                            </span>
                            <span>{t(tab.label, lang)}</span>
                        </button>
                    ))}
                </nav>
            </div>

            <div className="flex-1 flex justify-center overflow-hidden">
                <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
                    <div className="shrink-0 px-8 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
                        <div>
                            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                                {TABS.find(tab => tab.id === state.activeTab)?.label && t(TABS.find(tab => tab.id === state.activeTab)!.label, lang)}
                            </h3>
                            <p className="text-sm text-text-muted mt-1.5 opacity-80">
                                {t('settings.managePreferences', lang)}
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group"
                            title={t('settings.closeSettings', lang)}
                        >
                            <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                        </button>
                    </div>

                    <div className="settings-scroll-region flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-28">
                        <div className="settings-tab-panel space-y-6">
                            <Suspense fallback={<SettingsTabFallback language={lang} />}>
                                {renderTab()}
                            </Suspense>
                        </div>
                    </div>

                    {isDirty && (
                        <div className="absolute bottom-6 right-8 left-8 p-4 rounded-xl bg-surface/95 border border-border/60 shadow-lg flex items-center justify-between z-10 transition-all duration-300">
                            <span className="text-xs text-text-muted ml-2 font-medium">
                                {t('settings.unsavedChanges', lang)}
                            </span>
                            <div className="flex items-center gap-3">
                                <ActionButton variant="ghost" onClick={handleClose} className="hover:bg-text-primary/[0.05] text-text-secondary rounded-lg">
                                    {t('statusBar.cancel', lang)}
                                </ActionButton>
                                <ActionButton
                                    variant="primary"
                                    onClick={handleSave}
                                    className="min-w-[140px] shadow-lg transition-all duration-300 rounded-xl bg-accent hover:bg-accent-hover text-white shadow-accent/20"
                                >
                                    <span className="font-bold">{t('settings.saveChanges', lang)}</span>
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