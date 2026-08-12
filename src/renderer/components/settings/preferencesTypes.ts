/**
 * Settings 组件共享类型定义
 */

import { Language } from '@renderer/i18n'
import type { LLMConfig, AutoApproveSettings, AgentConfig, WebSearchConfig } from '@shared/configuration/providerTypes'
import type { ProviderModelConfig } from '@shared/configuration/preferenceSync'

export type SettingsTab = 'provider' | 'appearance' | 'agent' | 'search' | 'voice' | 'vision' | 'rules' | 'memory' | 'skills' | 'mcp' | 'email' | 'channel' | 'security' | 'privacy' | 'perception' | 'causal' | 'iot' | 'system' | 'cloud' | 'desktop' | 'proactive' | string

export interface ProviderSettingsProps {
    localConfig: LLMConfig
    setLocalConfig: (config: LLMConfig) => void
    localProviderConfigs: Record<string, ProviderModelConfig>
    setLocalProviderConfigs: (configs: Record<string, ProviderModelConfig>) => void
    showApiKey: boolean
    setShowApiKey: (show: boolean) => void
    selectedProvider: { id: string; name: string; models: string[] } | undefined
    providers: { id: string; name: string; models: string[] }[]
    language: Language
    setProvider: (id: string, config: ProviderModelConfig) => void
}

export interface EditorSettingsState {
    // 编辑器外观
    fontSize: number
    chatFontSize: number
    tabSize: number
    wordWrap: 'on' | 'off' | 'wordWrapColumn'
    lineNumbers: 'on' | 'off' | 'relative'
    minimap: boolean
    bracketPairColorization: boolean
    formatOnSave: boolean
    autoSave: 'off' | 'afterDelay' | 'onFocusChange'
    autoSaveDelay: number
    theme: string

    // AI 补全
    completionEnabled: boolean
    completionDebounceMs: number
    completionMaxTokens: number
    completionTriggerChars: string[]

    // 终端
    terminalScrollback: number
    terminalMaxOutputLines: number

    // LSP
    lspTimeoutMs: number
    lspCompletionTimeoutMs: number

    // 性能
    largeFileWarningThresholdMB: number
    largeFileLineCount: number
    commandTimeoutMs: number
    workerTimeoutMs: number
    healthCheckTimeoutMs: number
    maxProjectFiles: number
    maxFileTreeDepth: number
    maxSearchResults: number
    saveDebounceMs: number
    flushIntervalMs: number
}

export interface EditorSettingsProps {
    settings: EditorSettingsState
    setSettings: (settings: EditorSettingsState) => void
    advancedConfig: import('@shared/configuration/configTypes').EditorConfig
    setAdvancedConfig: (config: import('@shared/configuration/configTypes').EditorConfig) => void
    language: Language
    localLanguage?: Language
    setLocalLanguage?: (lang: Language) => void
    /**
     * 立即应用语言切换（阶段7 s7-09）
     * 若提供，则点击语言卡片时立即更新 store + 同步主进程 + 后台持久化，
     * 而非等待用户点击"保存"。fallback 到 setLocalLanguage 以保持向后兼容。
     */
    applyLanguageImmediately?: (lang: Language) => void
}

export interface AgentSettingsProps {
    autoApprove: AutoApproveSettings
    setAutoApprove: (value: AutoApproveSettings) => void
    aiInstructions: string
    setAiInstructions: (value: string) => void
    promptTemplateId: string
    setPromptTemplateId: (value: string) => void
    agentConfig: AgentConfig
    setAgentConfig: (config: AgentConfig) => void
    webSearchConfig: WebSearchConfig
    setWebSearchConfig: (config: WebSearchConfig) => void
    language: Language
}

export interface PromptPreviewModalProps {
    templateId: string
    language: Language
    onClose: () => void
}

export const LANGUAGES: { id: Language; name: string }[] = [
    { id: 'zh', name: '中文' },
    { id: 'en', name: 'English' },
]
