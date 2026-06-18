/**
 * 开发助手场景专属设置状态管理 Hook
 *
 * 仅管理编辑器相关配置：编辑器设置、高级编辑器配置
 * 独立于全局 useSettingsLocalState，避免引入不必要的依赖
 */

import { useState, useMemo, useCallback } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '@shared/toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import type { EditorConfig } from '@shared/configuration/configTypes'
import type { EditorSettingsState } from '@components/settings/preferencesTypes'

export type DevAssistantSettingsTab = 'editor' | 'snippets' | 'indexing' | 'lsp' | 'keybindings'

function toEditorSettingsState(config: EditorConfig): EditorSettingsState {
    return {
        fontSize: config.fontSize ?? 14,
        chatFontSize: config.chatFontSize ?? 14,
        tabSize: config.tabSize ?? 2,
        wordWrap: config.wordWrap ?? 'off',
        lineNumbers: config.lineNumbers ?? 'on',
        minimap: config.minimap ?? true,
        bracketPairColorization: config.bracketPairColorization ?? true,
        formatOnSave: config.formatOnSave ?? false,
        autoSave: config.autoSave ?? 'off',
        autoSaveDelay: config.autoSaveDelay ?? 1000,
        theme: 'light',
        completionEnabled: config.ai?.completionEnabled ?? true,
        completionDebounceMs: config.performance?.completionDebounceMs ?? 150,
        completionMaxTokens: config.ai?.completionMaxTokens ?? 256,
        completionTriggerChars: config.ai?.completionTriggerChars ?? ['.', '/', '@'],
        terminalScrollback: config.terminal?.scrollback ?? 1000,
        terminalMaxOutputLines: config.terminal?.maxOutputLines ?? 5000,
        lspTimeoutMs: config.lsp?.timeoutMs ?? 10000,
        lspCompletionTimeoutMs: config.lsp?.completionTimeoutMs ?? 5000,
        largeFileWarningThresholdMB: config.performance?.largeFileWarningThresholdMB ?? 5,
        largeFileLineCount: config.performance?.largeFileLineCount ?? 20000,
        commandTimeoutMs: config.performance?.commandTimeoutMs ?? 30000,
        workerTimeoutMs: config.performance?.workerTimeoutMs ?? 60000,
        healthCheckTimeoutMs: config.performance?.healthCheckTimeoutMs ?? 15000,
        maxProjectFiles: config.performance?.maxProjectFiles ?? 50000,
        maxFileTreeDepth: config.performance?.maxFileTreeDepth ?? 10,
        maxSearchResults: config.performance?.maxSearchResults ?? 5000,
        saveDebounceMs: config.performance?.saveDebounceMs ?? 1000,
        flushIntervalMs: config.performance?.flushIntervalMs ?? 5000,
    }
}

interface DevAssistantSettingsState {
    activeTab: DevAssistantSettingsTab
    editorSettings: EditorSettingsState
    advancedEditorConfig: EditorConfig
}

export function useDevAssistantSettings() {
    const storeValues = useStore(useShallow((s) => ({
        language: s.language,
        editorConfig: s.editorConfig,
        set: s.set,
        save: s.save,
    })))

    const { language, editorConfig, set, save } = storeValues

    const [state, setState] = useState<DevAssistantSettingsState>({
        activeTab: 'editor',
        editorSettings: toEditorSettingsState(editorConfig),
        advancedEditorConfig: { ...editorConfig },
    })

    const setActiveTab = useCallback((tab: DevAssistantSettingsTab) => {
        setState(prev => ({ ...prev, activeTab: tab }))
    }, [])

    const setEditorSettings = useCallback((settings: EditorSettingsState) => {
        setState(prev => ({ ...prev, editorSettings: settings }))
    }, [])

    const setAdvancedConfig = useCallback((config: EditorConfig) => {
        setState(prev => ({ ...prev, advancedEditorConfig: config }))
    }, [])

    // 合并编辑器配置
    const finalEditorConfig = useMemo(() => ({
        ...state.advancedEditorConfig,
        fontSize: state.editorSettings.fontSize,
        chatFontSize: state.editorSettings.chatFontSize,
        tabSize: state.editorSettings.tabSize,
        wordWrap: state.editorSettings.wordWrap,
        lineNumbers: state.editorSettings.lineNumbers,
        minimap: state.editorSettings.minimap,
        bracketPairColorization: state.editorSettings.bracketPairColorization,
        formatOnSave: state.editorSettings.formatOnSave,
        autoSave: state.editorSettings.autoSave,
        autoSaveDelay: state.editorSettings.autoSaveDelay,
        ai: {
            ...state.advancedEditorConfig.ai,
            completionEnabled: state.editorSettings.completionEnabled,
            completionMaxTokens: state.editorSettings.completionMaxTokens,
            completionTriggerChars: state.editorSettings.completionTriggerChars,
        },
        terminal: {
            ...state.advancedEditorConfig.terminal,
            scrollback: state.editorSettings.terminalScrollback,
            maxOutputLines: state.editorSettings.terminalMaxOutputLines,
        },
        lsp: {
            ...state.advancedEditorConfig.lsp,
            timeoutMs: state.editorSettings.lspTimeoutMs,
            completionTimeoutMs: state.editorSettings.lspCompletionTimeoutMs,
        },
        performance: {
            ...state.advancedEditorConfig.performance,
            completionDebounceMs: state.editorSettings.completionDebounceMs,
            largeFileWarningThresholdMB: state.editorSettings.largeFileWarningThresholdMB,
            largeFileLineCount: state.editorSettings.largeFileLineCount,
            commandTimeoutMs: state.editorSettings.commandTimeoutMs,
            workerTimeoutMs: state.editorSettings.workerTimeoutMs,
            healthCheckTimeoutMs: state.editorSettings.healthCheckTimeoutMs,
            maxProjectFiles: state.editorSettings.maxProjectFiles,
            maxFileTreeDepth: state.editorSettings.maxFileTreeDepth,
            maxSearchResults: state.editorSettings.maxSearchResults,
            saveDebounceMs: state.editorSettings.saveDebounceMs,
            flushIntervalMs: state.editorSettings.flushIntervalMs,
        },
    }), [state.advancedEditorConfig, state.editorSettings])

    // isDirty 检测
    const isDirty = useMemo(() => {
        const current = JSON.stringify(finalEditorConfig)
        const original = JSON.stringify(editorConfig)
        return current !== original
    }, [finalEditorConfig, editorConfig])

    // 保存
    const handleSave = useCallback(async () => {
        if (!isDirty) return

        try {
            set('editorConfig', finalEditorConfig)
            await save()
            toast.success(t('success.settingsSaved', language as Language))
        } catch (error) {
            logger.settings.error('保存编辑器设置失败:', error)
            toast.error(error instanceof Error ? error.message : String(error))
        }
    }, [isDirty, finalEditorConfig, set, save, language])

    return {
        state,
        setActiveTab,
        setEditorSettings,
        setAdvancedConfig,
        finalEditorConfig,
        isDirty,
        handleSave,
        language,
    }
}