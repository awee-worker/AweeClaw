/**
 * Agent 设置组件
 *
 */

import { useState } from 'react'
import { DEFAULT_AGENT_CONFIG } from '@configuration/agentProfile'
import { TextField } from '@components/ui'
import { AgentSettingsProps } from '../preferencesTypes'
import { FileText, BrainCircuit, AlertOctagon, RefreshCw } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { SoundNotificationPanel } from './SoundNotificationPanel'

export function AgentProfilePanel({
    agentConfig, setAgentConfig,
    language
}: AgentSettingsProps) {
    const [showAdvanced, setShowAdvanced] = useState(false)

    // 使用 DEFAULT_AGENT_CONFIG 中的忽略目录作为默认值（仅供高级设置区使用）
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig.ignoredDirectories || defaultIgnoredDirs).join(', ')
    )

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
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.keepecentturns', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.keepRecentTurns ?? 10}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 10 })}
                                            min={2}
                                            max={50}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.deepcompressionturns', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.deepCompressionTurns ?? 20}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 20 })}
                                            min={5}
                                            max={100}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-medium text-text-muted">{t('app.maximportantoldturns', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={agentConfig.maxImportantOldTurns ?? 5}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 5 })}
                                            min={0}
                                            max={30}
                                            className="bg-background/50 border-border text-xs h-9"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 循环检测 */}
                            <div className="space-y-3 pt-4 border-t border-border/30">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('app.loopdetection', language as Language)}</label>
                                    </div>
                                </div>
                                {/* 此处保留原 ToggleSwitch 引用，避免 import 缺失 */}
                                {/* 注意：循环检测开关仍在此处，属于运行参数 */}
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
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.sametoolwarningthreshold', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.sameToolWarningThreshold ?? 5}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, sameToolWarningThreshold: parseInt(e.target.value) || 5 }
                                                    })}
                                                    min={3}
                                                    max={20}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.patternwarningthreshold', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.patternWarningThreshold ?? 5}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, patternWarningThreshold: parseInt(e.target.value) || 5 }
                                                    })}
                                                    min={3}
                                                    max={15}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-text-muted">{t('app.patternhardstop', language as Language)}</label>
                                                <TextField
                                                    type="number"
                                                    value={agentConfig.loopDetection?.patternRepeatHardStop ?? 8}
                                                    onChange={(e) => setAgentConfig({
                                                        ...agentConfig,
                                                        loopDetection: { ...agentConfig.loopDetection, enabled: true, patternRepeatHardStop: parseInt(e.target.value) || 8 }
                                                    })}
                                                    min={5}
                                                    max={20}
                                                    className="bg-background/50 border-border text-xs h-9"
                                                />
                                            </div>
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

            {/* 声音提醒 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    <SoundNotificationPanel
                        settings={agentConfig.soundNotifications ?? { enabled: false, taskComplete: true, taskError: true, needApproval: true }}
                        onChange={(settings) => setAgentConfig({ ...agentConfig, soundNotifications: settings })}
                        language={language}
                    />
                </div>
            </section>
        </div>
    )
}
