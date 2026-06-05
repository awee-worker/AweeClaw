/**
 * Agent 设置组件
 * 完整的 Agent 高级配置面板
 */

import { useState } from 'react'
import { getPromptTemplates } from '@intelligence/prompt-engine/promptLibrary'
import { DEFAULT_AGENT_CONFIG } from '@configuration/agentProfile'
import { ActionButton, TextField, DropdownSelector, ToggleSwitch } from '@components/ui'
import { AgentSettingsProps } from '../preferencesTypes'
import { PromptPreviewDialog } from './PromptPreviewDialog'
import { Bot, FileText, Zap, BrainCircuit, AlertOctagon, RefreshCw, Users, UserPlus, Trash2, GripVertical, X, Check } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

export function AgentProfilePanel({
    autoApprove, setAutoApprove, aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
    language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [showAgentRoles, setShowAgentRoles] = useState(false)
    const [capabilityInput, setCapabilityInput] = useState<{ index: number; value: string } | null>(null)

    // 使用 DEFAULT_AGENT_CONFIG 中的忽略目录作为默认值
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig.ignoredDirectories || defaultIgnoredDirs).join(', ')
    )

    const handlePreviewTemplate = (templateId: string) => {
        setSelectedTemplateForPreview(templateId)
        setShowPreview(true)
    }

    const handleIgnoredDirsChange = (value: string) => {
        setIgnoredDirsInput(value)
        const dirs = value.split(',').map(d => d.trim()).filter(Boolean)
        setAgentConfig({ ...agentConfig, ignoredDirectories: dirs })
    }

    const resetIgnoredDirs = () => {
        setIgnoredDirsInput(defaultIgnoredDirs.join(', '))
        setAgentConfig({ ...agentConfig, ignoredDirectories: defaultIgnoredDirs })
    }

    return (
        <div className="space-y-4 animate-fade-in pb-10">
            {/* 行为权限 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <Zap className="w-3.5 h-3.5" />
                        </div>
                        <h5 className="text-sm font-semibold text-text-primary">{t('app.permissions', language as Language)}</h5>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.autoapproveterminal', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.terminalcommandswithoutconfirmation', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={autoApprove.terminal}
                                onChange={(e) => setAutoApprove({ ...autoApprove, terminal: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.autoapprovedangerous', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.dangerousopswithoutconfirmation', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={autoApprove.dangerous}
                                onChange={(e) => setAutoApprove({ ...autoApprove, dangerous: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.autocheckfix', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.autodetectandfix', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.enableAutoFix}
                                onChange={(e) => setAgentConfig({ ...agentConfig, enableAutoFix: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.expandthinkingblocks', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.expandthinkingdesc', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.expandThinkingByDefault ?? true}
                                onChange={(e) => setAgentConfig({ ...agentConfig, expandThinkingByDefault: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.expandtoolblocks', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.expandtooldesc', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.expandToolCallsByDefault ?? false}
                                onChange={(e) => setAgentConfig({ ...agentConfig, expandToolCallsByDefault: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('app.expandcontextblocks', language as Language)}</label>
                                <p className="text-[10px] text-text-muted">{t('app.expandcontextdesc', language as Language)}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.expandContextByDefault ?? true}
                                onChange={(e) => setAgentConfig({ ...agentConfig, expandContextByDefault: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                    </div>
                    {(autoApprove.terminal || autoApprove.dangerous) && (
                        <div className="flex items-start gap-2 p-2.5 mt-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px]">
                            <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <p>{t('app.autoapproveenabledagentwill', language as Language)}</p>
                        </div>
                    )}
                </div>
            </section>

            {/* Prompt 模板 & 自定义指令 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <Bot className="w-3.5 h-3.5" />
                        </div>
                        <h5 className="text-sm font-semibold text-text-primary">{t('app.promptinstructions', language as Language)}</h5>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('app.selecttemplate', language as Language)}</label>
                                <DropdownSelector
                                    value={promptTemplateId}
                                    onChange={(value) => setPromptTemplateId(value)}
                                    options={templates.map(t => ({
                                        value: t.id,
                                        label: `${t.name} ${t.isDefault ? '(Default)' : ''}`
                                    }))}
                                    className="w-full bg-background/50 border-border text-xs"
                                />
                            </div>
                            <div className="bg-surface/50 p-3 rounded-lg border border-border/50 space-y-2">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-text-primary">
                                        {templates.find(t => t.id === promptTemplateId)?.name}
                                    </span>
                                    <span className="text-[11px] text-text-muted px-1.5 py-0.5 bg-background/50 rounded border border-border">
                                        P{templates.find(t => t.id === promptTemplateId)?.priority}
                                    </span>
                                    {templates.find(t => t.id === promptTemplateId)?.tags?.map(tag => (
                                        <span key={tag} className="text-[11px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-xs text-text-secondary line-clamp-2">
                                    {language === 'zh'
                                        ? templates.find(t => t.id === promptTemplateId)?.descriptionZh
                                        : templates.find(t => t.id === promptTemplateId)?.description}
                                </p>
                                <ActionButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handlePreviewTemplate(promptTemplateId)}
                                    className="w-full text-xs h-7 mt-1"
                                >
                                    {t('app.previewfullprompt', language as Language)}
                                </ActionButton>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('app.custominstructions', language as Language)}</label>
                            <textarea
                                value={aiInstructions}
                                onChange={(e) => setAiInstructions(e.target.value)}
                                placeholder={t('app.enterglobalsysteminstructions', language as Language)}
                                className="w-full h-[calc(100%-24px)] min-h-[140px] p-3 bg-background/50 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none resize-none text-xs font-mono custom-scrollbar text-text-primary placeholder-text-muted/50"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* 基础参数 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <BrainCircuit className="w-3.5 h-3.5" />
                        </div>
                        <h5 className="text-sm font-semibold text-text-primary">{t('app.parameters', language as Language)}</h5>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('app.maxloops', language as Language)}</label>
                            <TextField
                                type="number"
                                value={agentConfig.maxToolLoops}
                                onChange={(e) => setAgentConfig({ ...agentConfig, maxToolLoops: parseInt(e.target.value) || 20 })}
                                min={5}
                                max={500}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('app.maxhistory', language as Language)}</label>
                            <TextField
                                type="number"
                                value={agentConfig.maxHistoryMessages}
                                onChange={(e) => setAgentConfig({ ...agentConfig, maxHistoryMessages: parseInt(e.target.value) || 60 })}
                                min={10}
                                max={200}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('app.toolresultlimit', language as Language)}</label>
                            <TextField
                                type="number"
                                value={agentConfig.maxToolResultChars}
                                onChange={(e) => setAgentConfig({ ...agentConfig, maxToolResultChars: parseInt(e.target.value) || 10000 })}
                                step={5000}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('app.contexttokenlimit', language as Language)}</label>
                            <TextField
                                type="number"
                                value={agentConfig.maxContextTokens ?? 128000}
                                onChange={(e) => setAgentConfig({ ...agentConfig, maxContextTokens: parseInt(e.target.value) || 128000 })}
                                step={10000}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* 高级设置（可折叠） */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-between p-5 cursor-pointer focus:outline-none relative z-10"
                >
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <FileText className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-left">
                            <h5 className="text-sm font-semibold text-text-primary">{t('app.advanced', language as Language)}</h5>
                            <p className="text-[11px] text-text-muted mt-0.5">{t('app.contextcompressionloopdetection', language as Language)}</p>
                        </div>
                    </div>
                    <div className={`p-1.5 rounded-full bg-surface-hover transition-transform duration-300 ${showAdvanced ? 'rotate-180' : ''}`}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </div>
                </button>

                <div className={`grid transition-all duration-300 ease-in-out ${showAdvanced ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                        <div className="p-5 pt-0 space-y-5 relative z-10">
                            {/* 上下文限制 */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.contextlimits', language as Language)}</label>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.filecontentlimit', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxFileContentChars ?? 15000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                            step={5000}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.maxfiles', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxContextFiles ?? 6}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxContextFiles: parseInt(e.target.value) || 6 })}
                                            min={1}
                                            max={20}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.semanticresults', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxSemanticResults ?? 5}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxSemanticResults: parseInt(e.target.value) || 5 })}
                                            min={1}
                                            max={20}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.terminallimit', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxTerminalChars ?? 3000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxTerminalChars: parseInt(e.target.value) || 3000 })}
                                            step={1000}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 上下文压缩 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.contextcompression', language as Language)}</label>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.keeprecentturns', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.keepRecentTurns ?? 5}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 5 })}
                                            min={2}
                                            max={20}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.deepcompression', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.deepCompressionTurns ?? 2}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 2 })}
                                            min={1}
                                            max={5}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.importantold', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxImportantOldTurns ?? 3}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 3 })}
                                            min={0}
                                            max={10}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
                                    <ToggleSwitch
                                        label={t('app.enablellmsummary', language as Language)}
                                        checked={agentConfig.enableLLMSummary ?? true}
                                        onChange={(e) => setAgentConfig({ ...agentConfig, enableLLMSummary: e.target.checked })}
                                        className="text-[12px]"
                                    />
                                    <ToggleSwitch
                                        label={t('app.autohandoff', language as Language)}
                                        checked={agentConfig.autoHandoff ?? true}
                                        onChange={(e) => setAgentConfig({ ...agentConfig, autoHandoff: e.target.checked })}
                                        className="text-[12px]"
                                    />
                                    <ToggleSwitch
                                        label={t('app.autocontextrag', language as Language)}
                                        checked={agentConfig.enableAutoContext ?? true}
                                        onChange={(e) => setAgentConfig({ ...agentConfig, enableAutoContext: e.target.checked })}
                                        className="text-[12px]"
                                    />
                                </div>
                            </div>

                            {/* 循环检测 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.loopdetection', language as Language)}</label>
                                    </div>
                                    <ToggleSwitch
                                        label={t('app.enabled', language as Language)}
                                        checked={agentConfig.loopDetection?.enabled ?? true}
                                        onChange={(e) => setAgentConfig({
                                            ...agentConfig,
                                            loopDetection: {
                                                ...agentConfig.loopDetection,
                                                enabled: e.target.checked,
                                                maxHistory: agentConfig.loopDetection?.maxHistory ?? 50,
                                                maxExactRepeats: agentConfig.loopDetection?.maxExactRepeats ?? 5,
                                                maxSameTargetRepeats: agentConfig.loopDetection?.maxSameTargetRepeats ?? 8,
                                                patternRepeatHardStop: agentConfig.loopDetection?.patternRepeatHardStop ?? 3,
                                                dynamicThreshold: agentConfig.loopDetection?.dynamicThreshold ?? true,
                                            }
                                        })}
                                        className="text-[12px]"
                                    />
                                </div>

                                {agentConfig.loopDetection?.enabled !== false && (
                                    <>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.historysize', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.maxHistory ?? 50}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, maxHistory: parseInt(e.target.value) || 50 }
                                                    })}
                                                    min={10}
                                                    max={200}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.exactrepeatlimit', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.maxExactRepeats ?? 5}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, maxExactRepeats: parseInt(e.target.value) || 5 }
                                                    })}
                                                    min={2}
                                                    max={30}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.sametargetlimit', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.maxSameTargetRepeats ?? 8}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, maxSameTargetRepeats: parseInt(e.target.value) || 8 }
                                                    })}
                                                    min={3}
                                                    max={30}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.patternhardstop', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.patternRepeatHardStop ?? 3}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, patternRepeatHardStop: parseInt(e.target.value) || 3 }
                                                    })}
                                                    min={2}
                                                    max={10}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
                                            <ToggleSwitch
                                                label={t('app.dynamicthresholdautorelax', language as Language)}
                                                checked={agentConfig.loopDetection?.dynamicThreshold ?? true}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: { ...agentConfig.loopDetection, enabled: true, dynamicThreshold: e.target.checked }
                                                })}
                                                className="text-[12px]"
                                            />
                                        </div>
                                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
                                            <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <p>{t('app.loopdetectionwarnsor', language as Language)}</p>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* 重试 & 超时 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.retrytimeout', language as Language)}</label>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.maxretries', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxRetries ?? 3}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxRetries: parseInt(e.target.value) || 3 })}
                                            min={0}
                                            max={10}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.retrydelay', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.tooltimeout', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.toolTimeoutMs ?? 60000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, toolTimeoutMs: parseInt(e.target.value) || 60000 })}
                                            step={5000}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 忽略目录 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.ignoreddirs', language as Language)}</label>
                                    </div>
                                    <button
                                        onClick={resetIgnoredDirs}
                                        className="text-[11px] font-bold text-accent hover:text-accent-hover transition-colors flex items-center gap-1 bg-accent/5 px-2 py-0.5 rounded border border-accent/20"
                                    >
                                        <RefreshCw className="w-2.5 h-2.5" />
                                        {t('app.reset', language as Language)}
                                    </button>
                                </div>
                                <textarea
                                    value={ignoredDirsInput}
                                    onChange={(e) => handleIgnoredDirsChange(e.target.value)}
                                    className="w-full h-20 p-3 bg-background/50 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none text-xs font-mono resize-none text-text-secondary custom-scrollbar"
                                    placeholder="node_modules, .git, ..."
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 多智能体协作 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <button
                    onClick={() => setShowAgentRoles(!showAgentRoles)}
                    className="w-full flex items-center justify-between p-5 cursor-pointer focus:outline-none relative z-10"
                >
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <Users className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-left">
                            <h5 className="text-sm font-semibold text-text-primary">{t('app.multiagentcollaboration', language as Language)}</h5>
                            <p className="text-[11px] text-text-muted mt-0.5">{t('app.configuremultiagentcollaborationmode', language as Language)}</p>
                        </div>
                    </div>
                    <div className={`p-1.5 rounded-full bg-surface-hover transition-transform duration-300 ${showAgentRoles ? 'rotate-180' : ''}`}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </div>
                </button>

                <div className={`grid transition-all duration-300 ease-in-out ${showAgentRoles ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                        <div className="p-5 pt-0 space-y-5 relative z-10">
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px]">
                                <span className="text-base shrink-0 mt-0.5">🐱</span>
                                <div>
                                    <p className="font-medium text-xs text-text-primary mb-1">{t('app.teamcollaborationmode', language as Language)}</p>
                                    <p>{t('app.clickthebuttonin', language as Language)}</p>
                                </div>
                            </div>

                            {agentConfig.customAgentProfiles && agentConfig.customAgentProfiles.length > 0 && (
                                <div className="space-y-3 pt-4 border-t border-border/30">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.customroles', language as Language)}</label>
                                    </div>

                                        {(agentConfig.customAgentProfiles ?? []).length === 0 ? (
                                            <div className="text-center py-6 text-text-muted text-xs">
                                                {t('app.nocustomrolesyet', language as Language)}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {(agentConfig.customAgentProfiles ?? []).map((profile, index) => (
                                                    <div
                                                        key={profile.id}
                                                        className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-background/30 group/role"
                                                    >
                                                        <GripVertical className="w-3.5 h-3.5 text-text-muted mt-1 cursor-grab" />
                                                        <div className="flex-1 min-w-0 space-y-2">
                                                            <div className="flex items-center gap-2">
                                                                <TextField
                                                                    type="text"
                                                                    value={profile.name}
                                                                    onChange={(e) => {
                                                                        const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                        profiles[index] = { ...profile, name: e.target.value }
                                                                        setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                    }}
                                                                    placeholder={t('app.rolename', language as Language)}
                                                                    className="bg-background/50 border-border text-xs h-8 flex-1"
                                                                />
                                                                <TextField
                                                                    type="number"
                                                                    value={profile.priority}
                                                                    onChange={(e) => {
                                                                        const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                        profiles[index] = { ...profile, priority: Math.min(10, Math.max(1, parseInt(e.target.value) || 5)) }
                                                                        setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                    }}
                                                                    min={1}
                                                                    max={10}
                                                                    className="bg-background/50 border-border text-xs h-8 w-16"
                                                                />
                                                                <ToggleSwitch
                                                                    checked={profile.enabled}
                                                                    onChange={(e) => {
                                                                        const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                        profiles[index] = { ...profile, enabled: e.target.checked }
                                                                        setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                    }}
                                                                    className="flex-shrink-0"
                                                                />
                                                            </div>
                                                            <TextField
                                                                type="text"
                                                                value={profile.description}
                                                                onChange={(e) => {
                                                                    const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                    profiles[index] = { ...profile, description: e.target.value }
                                                                    setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                }}
                                                                placeholder={t('app.roledescription', language as Language)}
                                                                className="bg-background/50 border-border text-xs h-8 w-full"
                                                            />
                                                            <textarea
                                                                value={profile.systemPrompt}
                                                                onChange={(e) => {
                                                                    const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                    profiles[index] = { ...profile, systemPrompt: e.target.value }
                                                                    setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                }}
                                                                placeholder={t('app.systempromptdefinesbehavior', language as Language)}
                                                                className="w-full h-16 p-2 bg-background/50 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none resize-none text-[11px] font-mono custom-scrollbar text-text-secondary placeholder-text-muted/50"
                                                            />
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {profile.capabilities.map((cap, capIdx) => (
                                                                    <span
                                                                        key={capIdx}
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px]"
                                                                    >
                                                                        {cap}
                                                                        <button
                                                                            onClick={() => {
                                                                                const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                                profiles[index] = {
                                                                                    ...profile,
                                                                                    capabilities: profile.capabilities.filter((_, i) => i !== capIdx)
                                                                                }
                                                                                setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                            }}
                                                                            className="hover:text-red-400"
                                                                        >
                                                                            <X className="w-2.5 h-2.5" />
                                                                        </button>
                                                                    </span>
                                                                ))}

                                                                {capabilityInput?.index === index ? (
                                                                    <div className="inline-flex items-center gap-1">
                                                                        <TextField
                                                                            type="text"
                                                                            value={capabilityInput.value}
                                                                            onChange={(e) => setCapabilityInput({ index, value: e.target.value })}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter') {
                                                                                    const cap = capabilityInput.value.trim()
                                                                                    if (cap) {
                                                                                        const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                                        profiles[index] = {
                                                                                            ...profile,
                                                                                            capabilities: [...profile.capabilities, cap]
                                                                                        }
                                                                                        setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                                    }
                                                                                    setCapabilityInput(null)
                                                                                } else if (e.key === 'Escape') {
                                                                                    setCapabilityInput(null)
                                                                                }
                                                                            }}
                                                                            placeholder={t('app.capabilitytag', language as Language)}
                                                                            className="bg-background/50 border-border text-[10px] h-6 w-24 py-0"
                                                                            autoFocus
                                                                        />
                                                                        <button
                                                                            onClick={() => {
                                                                                const cap = capabilityInput.value.trim()
                                                                                if (cap) {
                                                                                    const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                                    profiles[index] = {
                                                                                        ...profile,
                                                                                        capabilities: [...profile.capabilities, cap]
                                                                                    }
                                                                                    setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                                }
                                                                                setCapabilityInput(null)
                                                                            }}
                                                                            className="text-accent hover:text-accent-hover"
                                                                        >
                                                                            <Check className="w-3 h-3" />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setCapabilityInput(null)}
                                                                            className="text-text-muted hover:text-text-primary"
                                                                        >
                                                                            <X className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => setCapabilityInput({ index, value: '' })}
                                                                        className="px-1.5 py-0.5 rounded border border-dashed border-border text-text-muted text-[10px] hover:border-accent hover:text-accent transition-colors"
                                                                    >
                                                                        + {t('app.capability', language as Language)}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const profiles = (agentConfig.customAgentProfiles ?? []).filter((_, i) => i !== index)
                                                                setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                            }}
                                                            className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover/role:opacity-100"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <ActionButton
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                const newProfile = {
                                                    id: `custom-${Date.now()}`,
                                                    name: t('app.newrole', language as Language),
                                                    description: '',
                                                    systemPrompt: '',
                                                    capabilities: [],
                                                    priority: 5,
                                                    enabled: true,
                                                }
                                                setAgentConfig({
                                                    ...agentConfig,
                                                    customAgentProfiles: [...(agentConfig.customAgentProfiles ?? []), newProfile]
                                                })
                                            }}
                                            className="w-full text-xs h-8"
                                        >
                                            <UserPlus className="w-3.5 h-3.5 mr-1" />
                                            {t('app.addcustomrole', language as Language)}
                                        </ActionButton>

                                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
                                            <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <p>{t('app.customroleswillparticipate', language as Language)}</p>
                                        </div>
                                    </div>
                                )}
                        </div>
                    </div>
                </div>
            </section>

            {showPreview && selectedTemplateForPreview && (
                <PromptPreviewDialog
                    templateId={selectedTemplateForPreview}
                    language={language}
                    onClose={() => setShowPreview(false)}
                />
            )}
        </div>
    )
}
