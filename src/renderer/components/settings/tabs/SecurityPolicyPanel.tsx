/**
 * 安全设置组件
 *
 */

import { useState } from 'react'
import { AlertTriangle, Plus, X, RotateCcw, ShieldCheck, ShieldAlert, FolderLock, Ban } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import { api } from '../../../adapters/electronBridge'
import { DEFAULT_AGENT_CONFIG } from '@configuration/agentProfile'
import type { SecurityPolicyPanel as SecuritySettingsState } from '@shared/configuration/providerTypes'
import type { AgentConfig, AutoApproveSettings } from '@shared/configuration/configTypes'

interface SecuritySettingsProps {
    language: Language
    securitySettings: SecuritySettingsState
    setSecuritySettings: (settings: SecuritySettingsState) => void
    isWorkspaceEditor?: boolean
    /** 操作审批配置（从 AgentProfilePanel 迁入，存储于 autoApprove） */
    autoApprove?: AutoApproveSettings
    setAutoApprove?: (value: AutoApproveSettings) => void
    /** Agent 配置（用于 enableAutoFix 和 ignoredDirectories，存储于 agentConfig） */
    agentConfig?: AgentConfig
    setAgentConfig?: (config: AgentConfig) => void
}

export function SecurityPolicyPanel({
    language,
    securitySettings,
    setSecuritySettings,
    isWorkspaceEditor = true,
    autoApprove,
    setAutoApprove,
    agentConfig,
    setAgentConfig,
}: SecuritySettingsProps) {
    const [newShellCmd, setNewShellCmd] = useState('')
    const [newGitCmd, setNewGitCmd] = useState('')

    // 忽略目录输入框本地状态（与 agentConfig.ignoredDirectories 同步）
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig?.ignoredDirectories || defaultIgnoredDirs).join(', ')
    )

    const updateSecuritySettings = (updates: Partial<SecuritySettingsState>) => {
        setSecuritySettings({ ...securitySettings, ...updates })
    }

    const updateAutoApprove = (updates: Partial<AutoApproveSettings>) => {
        if (!autoApprove || !setAutoApprove) return
        setAutoApprove({ ...autoApprove, ...updates })
    }

    const updateAgentConfig = (updates: Partial<AgentConfig>) => {
        if (!agentConfig || !setAgentConfig) return
        setAgentConfig({ ...agentConfig, ...updates })
    }

    const handleAddShellCommand = () => {
        const cmd = newShellCmd.trim().toLowerCase()
        if (cmd && !(securitySettings.deniedShellCommands || []).includes(cmd)) {
            updateSecuritySettings({
                deniedShellCommands: [...(securitySettings.deniedShellCommands || []), cmd],
            })
            setNewShellCmd('')
        }
    }

    const handleRemoveShellCommand = (cmd: string) => {
        updateSecuritySettings({
            deniedShellCommands: (securitySettings.deniedShellCommands || []).filter(item => item !== cmd),
        })
    }

    const handleAddGitCommand = () => {
        const cmd = newGitCmd.trim().toLowerCase()
        if (cmd && !securitySettings.allowedGitSubcommands?.includes(cmd)) {
            updateSecuritySettings({
                allowedGitSubcommands: [...(securitySettings.allowedGitSubcommands || []), cmd],
            })
            setNewGitCmd('')
        }
    }

    const handleRemoveGitCommand = (cmd: string) => {
        updateSecuritySettings({
            allowedGitSubcommands: (securitySettings.allowedGitSubcommands || []).filter(item => item !== cmd),
        })
    }

    const handleResetBlacklist = async () => {
        try {
            const result = await api.settings.resetBlacklist()
            updateSecuritySettings({
                deniedShellCommands: result.shell,
            })
        } catch (error) {
            toast.error(t('settings.failedtoresetwhitelist', language as Language), error instanceof Error ? error.message : String(error))
        }
    }

    const handleIgnoredDirsChange = (value: string) => {
        setIgnoredDirsInput(value)
        const dirs = value.split(',').map(d => d.trim()).filter(Boolean)
        updateAgentConfig({ ignoredDirectories: dirs })
    }

    const resetIgnoredDirs = () => {
        setIgnoredDirsInput(defaultIgnoredDirs.join(', '))
        updateAgentConfig({ ignoredDirectories: defaultIgnoredDirs })
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            {/* 沙箱说明 */}
            <div className="p-5 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
                <div className="p-2 bg-yellow-500/10 rounded-lg shrink-0">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-yellow-500 mb-1 tracking-tight">
                        {t('settings.securitysandbox', language as Language)}
                    </h3>
                    <p className="text-xs text-text-secondary leading-relaxed opacity-90">
                        {t('settings.aweeclawcurrentlyrunscommandsdirectly', language as Language)}
                    </p>
                </div>
            </div>

            {/* 权限与审批（合并原"操作审批"+"安全选项"） */}
            <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                        <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
                        {t('settings.permissionandapproval', language as Language)}
                    </h4>
                </div>
                <p className="text-xs text-text-secondary -mt-2 ml-1">
                    {t('settings.permissionandapprovaldesc', language as Language)}
                </p>
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                    {/* 操作审批类（autoApprove / enableAutoFix） */}
                    {autoApprove && setAutoApprove && agentConfig && setAgentConfig && (
                        <>
                            <ToggleSwitch
                                label={t('settings.autoapproveterminal', language as Language)}
                                checked={autoApprove.terminal}
                                onChange={(e) => updateAutoApprove({ terminal: e.target.checked })}
                            />
                            <ToggleSwitch
                                label={t('settings.autoapprovedangerous', language as Language)}
                                checked={autoApprove.dangerous}
                                onChange={(e) => updateAutoApprove({ dangerous: e.target.checked })}
                            />
                            <ToggleSwitch
                                label={t('settings.autodetectandfix', language as Language)}
                                checked={agentConfig.enableAutoFix}
                                onChange={(e) => updateAgentConfig({ enableAutoFix: e.target.checked })}
                            />
                        </>
                    )}
                    {/* 安全策略类（原"安全选项"） */}
                    <ToggleSwitch
                        label={t('settings.enablepermissionconfirmation', language as Language)}
                        checked={securitySettings.enablePermissionConfirm}
                        onChange={(e) => updateSecuritySettings({ enablePermissionConfirm: e.target.checked })}
                    />
                    <ToggleSwitch
                        label={t('settings.strictworkspacemode', language as Language)}
                        checked={securitySettings.strictWorkspaceMode}
                        onChange={(e) => updateSecuritySettings({ strictWorkspaceMode: e.target.checked })}
                    />
                    <ToggleSwitch
                        label={t('settings.showsecuritywarnings', language as Language)}
                        checked={securitySettings.showSecurityWarnings}
                        onChange={(e) => updateSecuritySettings({ showSecurityWarnings: e.target.checked })}
                    />
                </div>
            </section>

            {/* 访问边界（从 AgentProfilePanel 迁入） */}
            {agentConfig && setAgentConfig && (
                <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                                <FolderLock className="w-3.5 h-3.5" />
                            </div>
                            <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                                {t('settings.accessboundary', language as Language)}
                            </h4>
                        </div>
                        <button
                            onClick={resetIgnoredDirs}
                            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                            title={t('settings.resettodefaults', language as Language)}
                        >
                            <RotateCcw className="w-3 h-3" />
                            {t('settings.reset', language as Language)}
                        </button>
                    </div>
                    <p className="text-xs text-text-secondary">
                        {t('settings.accessboundarydesc', language as Language)}
                    </p>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <p>{t('settings.accessboundarywarn', language as Language)}</p>
                    </div>
                    <textarea
                        value={ignoredDirsInput}
                        onChange={(e) => handleIgnoredDirsChange(e.target.value)}
                        className="w-full h-24 p-3 bg-background/50 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none text-xs font-mono resize-none text-text-secondary custom-scrollbar"
                        placeholder="node_modules, .git, .env, ..."
                    />
                </section>
            )}

            {/* Shell 命令黑名单 */}
            <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-red-500/10 rounded-md text-red-400">
                            <Ban className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                            {t('settings.shellcommandwhitelist', language as Language)}
                        </h4>
                    </div>
                    <button
                        onClick={handleResetBlacklist}
                        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        title={t('settings.resettodefaults', language as Language)}
                    >
                        <RotateCcw className="w-3 h-3" />
                        {t('settings.reset', language as Language)}
                    </button>
                </div>
                <p className="text-xs text-text-secondary">
                    {t('settings.onlycommandsinthislist', language as Language)}
                </p>
                <div className="flex flex-wrap gap-2">
                    {(securitySettings.deniedShellCommands || []).map(cmd => (
                        <span key={cmd} className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-xs text-red-400 border border-red-500/20">
                            {cmd}
                            <button onClick={() => handleRemoveShellCommand(cmd)} className="hover:text-red-300 transition-colors">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newShellCmd}
                        onChange={(e) => setNewShellCmd(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddShellCommand()}
                        placeholder={t('settings.addcommand', language as Language)}
                        className="flex-1 px-3 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-red-400/50"
                    />
                    <button
                        onClick={handleAddShellCommand}
                        disabled={!newShellCmd.trim()}
                        className="px-3 py-1.5 bg-red-500/80 text-white rounded text-sm hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </section>

            {/* Git 子命令白名单 */}
            {isWorkspaceEditor && (
                <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                        {t('settings.gitsubcommandwhitelist', language as Language)}
                    </h4>
                    <p className="text-xs text-text-secondary">
                        {t('settings.onlygitsubcommandsinthis', language as Language)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {(securitySettings.allowedGitSubcommands || []).map(cmd => (
                            <span key={cmd} className="inline-flex items-center gap-1 px-2 py-1 bg-surface rounded text-xs text-text-secondary border border-border">
                                {cmd}
                                <button onClick={() => handleRemoveGitCommand(cmd)} className="hover:text-red-400 transition-colors">
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newGitCmd}
                            onChange={(e) => setNewGitCmd(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddGitCommand()}
                            placeholder={t('settings.addgitsubcommand', language as Language)}
                            className="flex-1 px-3 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                        />
                        <button
                            onClick={handleAddGitCommand}
                            disabled={!newGitCmd.trim()}
                            className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </section>
            )}
        </div>
    )
}
