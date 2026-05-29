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
import { Bot, FileText, Zap, BrainCircuit, AlertOctagon, Search, Eye, EyeOff, RefreshCw, Users, UserPlus, Trash2, GripVertical, X, Check } from 'lucide-react'

export function AgentProfilePanel({
    autoApprove, setAutoApprove, aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
    webSearchConfig, setWebSearchConfig, language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [showGoogleApiKey, setShowGoogleApiKey] = useState(false)
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

    const t = (zh: string, en: string) => language === 'zh' ? zh : en

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
                        <h5 className="text-sm font-semibold text-text-primary">{t('行为权限', 'Permissions')}</h5>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('自动批准终端命令', 'Auto-approve terminal')}</label>
                                <p className="text-[10px] text-text-muted">{t('终端命令无需确认', 'Terminal commands without confirmation')}</p>
                            </div>
                            <ToggleSwitch
                                checked={autoApprove.terminal}
                                onChange={(e) => setAutoApprove({ ...autoApprove, terminal: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('自动批准危险操作', 'Auto-approve dangerous')}</label>
                                <p className="text-[10px] text-text-muted">{t('危险操作无需确认', 'Dangerous ops without confirmation')}</p>
                            </div>
                            <ToggleSwitch
                                checked={autoApprove.dangerous}
                                onChange={(e) => setAutoApprove({ ...autoApprove, dangerous: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('启用自动检查与修复', 'Auto-check & Fix')}</label>
                                <p className="text-[10px] text-text-muted">{t('自动检测并修复问题', 'Auto detect and fix issues')}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.enableAutoFix}
                                onChange={(e) => setAgentConfig({ ...agentConfig, enableAutoFix: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
                            <div className="space-y-0.5 pr-3">
                                <label className="text-xs text-text-secondary">{t('展开 Agent 内容块', 'Expand Agent blocks')}</label>
                                <p className="text-[10px] text-text-muted">{t('默认展开 Think/工具/上下文', 'Expand Think/Tool/Context')}</p>
                            </div>
                            <ToggleSwitch
                                checked={agentConfig.expandAgentBlocksByDefault ?? false}
                                onChange={(e) => setAgentConfig({ ...agentConfig, expandAgentBlocksByDefault: e.target.checked })}
                                className="flex-shrink-0"
                            />
                        </div>
                    </div>
                    {(autoApprove.terminal || autoApprove.dangerous) && (
                        <div className="flex items-start gap-2 p-2.5 mt-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px]">
                            <AlertOctagon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <p>{t('已开启自动批准，Agent 将无需确认直接执行操作，请谨慎使用。', 'Auto-approve enabled. Agent will execute without confirmation. Use with caution.')}</p>
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
                        <h5 className="text-sm font-semibold text-text-primary">{t('Prompt 模板 & 指令', 'Prompt & Instructions')}</h5>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('选择模板', 'Select Template')}</label>
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
                                    {t('预览完整提示词', 'Preview Full Prompt')}
                                </ActionButton>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('自定义系统指令', 'Custom Instructions')}</label>
                            <textarea
                                value={aiInstructions}
                                onChange={(e) => setAiInstructions(e.target.value)}
                                placeholder={t(
                                    '在此输入全局系统指令，例如："总是使用中文回答"、"代码风格偏好..."',
                                    'Enter global system instructions here...'
                                )}
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
                        <h5 className="text-sm font-semibold text-text-primary">{t('基础参数', 'Parameters')}</h5>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('最大循环', 'Max Loops')}</label>
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
                            <label className="text-xs font-medium text-text-secondary">{t('最大历史消息', 'Max History')}</label>
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
                            <label className="text-xs font-medium text-text-secondary">{t('工具结果限制', 'Tool Result Limit')}</label>
                            <TextField
                                type="number"
                                value={agentConfig.maxToolResultChars}
                                onChange={(e) => setAgentConfig({ ...agentConfig, maxToolResultChars: parseInt(e.target.value) || 10000 })}
                                step={5000}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('上下文 Token 限制', 'Context Token Limit')}</label>
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

            {/* 网络搜索 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <Search className="w-3.5 h-3.5" />
                        </div>
                        <h5 className="text-sm font-semibold text-text-primary">{t('网络搜索', 'Web Search')}</h5>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">Google API Key</label>
                            <div className="relative">
                                <TextField
                                    type={showGoogleApiKey ? 'text' : 'password'}
                                    value={webSearchConfig.googleApiKey || ''}
                                    onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleApiKey: e.target.value })}
                                    placeholder={t('输入 Google API Key', 'Enter Google API Key')}
                                    className="bg-background/50 border-border text-xs pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-text-secondary">{t('搜索引擎 ID (CX)', 'Search Engine ID (CX)')}</label>
                            <TextField
                                type="text"
                                value={webSearchConfig.googleCx || ''}
                                onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleCx: e.target.value })}
                                placeholder={t('输入搜索引擎 ID', 'Enter Search Engine ID')}
                                className="bg-background/50 border-border text-xs"
                            />
                        </div>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 mt-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
                        <Search className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <p>{t('免费额度：每天 100 次搜索。未配置时使用 DuckDuckGo 备选。获取密钥：console.cloud.google.com', 'Free tier: 100 searches/day. Falls back to DuckDuckGo when not configured. Get keys at: console.cloud.google.com')}</p>
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
                            <h5 className="text-sm font-semibold text-text-primary">{t('高级设置', 'Advanced')}</h5>
                            <p className="text-[11px] text-text-muted mt-0.5">{t('上下文压缩、循环检测、忽略目录等', 'Context compression, loop detection, ignored dirs')}</p>
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
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('上下文限制', 'Context Limits')}</label>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('单文件内容限制', 'File Content Limit')}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxFileContentChars ?? 15000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                            step={5000}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('最大文件数', 'Max Files')}</label>
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
                                        <label className="text-[11px] font-medium text-text-muted">{t('语义搜索结果数', 'Semantic Results')}</label>
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
                                        <label className="text-[11px] font-medium text-text-muted">{t('终端输出限制', 'Terminal Limit')}</label>
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
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('上下文压缩', 'Context Compression')}</label>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('保留最近轮次', 'Keep Recent Turns')}</label>
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
                                        <label className="text-[11px] font-medium text-text-muted">{t('深度压缩轮次', 'Deep Compression')}</label>
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
                                        <label className="text-[11px] font-medium text-text-muted">{t('重要旧轮次', 'Important Old')}</label>
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
                                        label={t('启用 LLM 摘要', 'Enable LLM Summary')}
                                        checked={agentConfig.enableLLMSummary ?? true}
                                        onChange={(e) => setAgentConfig({ ...agentConfig, enableLLMSummary: e.target.checked })}
                                        className="text-[12px]"
                                    />
                                    <ToggleSwitch
                                        label={t('自动会话交接', 'Auto Handoff')}
                                        checked={agentConfig.autoHandoff ?? true}
                                        onChange={(e) => setAgentConfig({ ...agentConfig, autoHandoff: e.target.checked })}
                                        className="text-[12px]"
                                    />
                                    <ToggleSwitch
                                        label={t('智能上下文 (隐式检索)', 'Auto-Context (RAG)')}
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
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('循环检测', 'Loop Detection')}</label>
                                    </div>
                                    <ToggleSwitch
                                        label={t('启用', 'Enabled')}
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
                                                <label className="text-[11px] font-medium text-text-muted">{t('历史记录数量', 'History Size')}</label>
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
                                                <label className="text-[11px] font-medium text-text-muted">{t('精确重复阈值', 'Exact Repeat Limit')}</label>
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
                                                <label className="text-[11px] font-medium text-text-muted">{t('同目标编辑阈值', 'Same Target Limit')}</label>
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
                                                <label className="text-[11px] font-medium text-text-muted">{t('模式硬停止', 'Pattern Hard Stop')}</label>
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
                                                label={t('动态阈值（复杂任务自动放宽）', 'Dynamic Threshold (auto-relax)')}
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
                                            <p>{t('循环检测会在 AI 反复执行相同操作时发出警告或强制停止。读取类操作阈值自动乘以 6 倍。', 'Loop detection warns or force-stops when AI repeats. Read operations have 6x threshold multiplier.')}</p>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* 重试 & 超时 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                    <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('重试 & 超时', 'Retry & Timeout')}</label>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('最大重试', 'Max Retries')}</label>
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
                                        <label className="text-[11px] font-medium text-text-muted">{t('重试延迟 (ms)', 'Retry Delay')}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('工具超时 (ms)', 'Tool Timeout')}</label>
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
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('忽略目录', 'Ignored Dirs')}</label>
                                    </div>
                                    <button
                                        onClick={resetIgnoredDirs}
                                        className="text-[11px] font-bold text-accent hover:text-accent-hover transition-colors flex items-center gap-1 bg-accent/5 px-2 py-0.5 rounded border border-accent/20"
                                    >
                                        <RefreshCw className="w-2.5 h-2.5" />
                                        {t('重置', 'Reset')}
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
                            <h5 className="text-sm font-semibold text-text-primary">{t('多智能体协作', 'Multi-Agent Collaboration')}</h5>
                            <p className="text-[11px] text-text-muted mt-0.5">{t('配置多智能体协作模式和自定义角色', 'Configure multi-agent collaboration mode and custom roles')}</p>
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
                                <span className="text-base shrink-0 mt-0.5">🦞</span>
                                <div>
                                    <p className="font-medium text-xs text-text-primary mb-1">{t('团队协作模式', 'Team Collaboration Mode')}</p>
                                    <p>{t('在聊天输入框中点击 🦞 按钮即可开启团队协作模式。开启后，AI 将组建专业团队协作完成任务。', 'Click the 🦞 button in the chat input to enable team collaboration mode. When enabled, AI will assemble a professional team to collaborate on tasks.')}</p>
                                </div>
                            </div>

                            {agentConfig.customAgentProfiles && agentConfig.customAgentProfiles.length > 0 && (
                                <div className="space-y-3 pt-4 border-t border-border/30">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('自定义角色', 'Custom Roles')}</label>
                                    </div>

                                        {(agentConfig.customAgentProfiles ?? []).length === 0 ? (
                                            <div className="text-center py-6 text-text-muted text-xs">
                                                {t('暂无自定义角色，点击下方按钮添加', 'No custom roles yet. Click below to add one')}
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
                                                                    placeholder={t('角色名称', 'Role Name')}
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
                                                                placeholder={t('角色描述', 'Role Description')}
                                                                className="bg-background/50 border-border text-xs h-8 w-full"
                                                            />
                                                            <textarea
                                                                value={profile.systemPrompt}
                                                                onChange={(e) => {
                                                                    const profiles = [...(agentConfig.customAgentProfiles ?? [])]
                                                                    profiles[index] = { ...profile, systemPrompt: e.target.value }
                                                                    setAgentConfig({ ...agentConfig, customAgentProfiles: profiles })
                                                                }}
                                                                placeholder={t('系统提示词（定义该角色的行为和专业领域）', 'System prompt (defines behavior and expertise)')}
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
                                                                            placeholder={t('能力标签', 'Capability tag')}
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
                                                                        + {t('能力', 'Capability')}
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
                                                    name: t('新角色', 'New Role'),
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
                                            {t('添加自定义角色', 'Add Custom Role')}
                                        </ActionButton>

                                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
                                            <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <p>{t('自定义角色将在多智能体协作时与默认角色一起参与任务分解和执行。优先级越高，越优先分配关键子任务。', 'Custom roles will participate alongside default roles in multi-agent collaboration. Higher priority means more critical subtasks.')}</p>
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
