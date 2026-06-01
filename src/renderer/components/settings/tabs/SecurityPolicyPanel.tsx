import { useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, Plus, X, RotateCcw } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import { api } from '../../../adapters/electronBridge'
import type { SecurityPolicyPanel as SecuritySettingsState } from '@shared/configuration/providerTypes'

interface SecuritySettingsProps {
    language: Language
    securitySettings: SecuritySettingsState
    setSecuritySettings: Dispatch<SetStateAction<SecuritySettingsState>>
    isWorkspaceEditor?: boolean
}

export function SecurityPolicyPanel({ language, securitySettings, setSecuritySettings, isWorkspaceEditor = true }: SecuritySettingsProps) {
    const [newShellCmd, setNewShellCmd] = useState('')
    const [newGitCmd, setNewGitCmd] = useState('')

    const updateSecuritySettings = (updates: Partial<SecuritySettingsState>) => {
        setSecuritySettings((current) => ({ ...current, ...updates }))
    }

    const handleAddShellCommand = () => {
        const cmd = newShellCmd.trim().toLowerCase()
        if (cmd && !securitySettings.allowedShellCommands.includes(cmd)) {
            updateSecuritySettings({
                allowedShellCommands: [...securitySettings.allowedShellCommands, cmd],
            })
            setNewShellCmd('')
        }
    }

    const handleRemoveShellCommand = (cmd: string) => {
        updateSecuritySettings({
            allowedShellCommands: securitySettings.allowedShellCommands.filter(item => item !== cmd),
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

    const handleResetWhitelist = async () => {
        try {
            const result = await api.settings.resetWhitelist()
            updateSecuritySettings({
                allowedShellCommands: result.shell,
                allowedGitSubcommands: result.git,
            })
        } catch (error) {
            toast.error(t('settings.failedtoresetwhitelist', language as Language), error instanceof Error ? error.message : String(error))
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
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

            <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
                    {t('settings.securityoptions', language as Language)}
                </h4>
                <div className="space-y-4">
                    <ToggleSwitch label={t('settings.enablepermissionconfirmation', language as Language)} checked={securitySettings.enablePermissionConfirm} onChange={(e) => updateSecuritySettings({ enablePermissionConfirm: e.target.checked })} />
                    <ToggleSwitch label={t('settings.strictworkspacemode', language as Language)} checked={securitySettings.strictWorkspaceMode} onChange={(e) => updateSecuritySettings({ strictWorkspaceMode: e.target.checked })} />
                    <ToggleSwitch label={t('settings.showsecuritywarnings', language as Language)} checked={securitySettings.showSecurityWarnings} onChange={(e) => updateSecuritySettings({ showSecurityWarnings: e.target.checked })} />
                </div>
            </section>

            <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center justify-between">
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                        {t('settings.shellcommandwhitelist', language as Language)}
                    </h4>
                    <button
                        onClick={handleResetWhitelist}
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
                    {securitySettings.allowedShellCommands.map(cmd => (
                        <span key={cmd} className="inline-flex items-center gap-1 px-2 py-1 bg-surface rounded text-xs text-text-secondary border border-border">
                            {cmd}
                            <button onClick={() => handleRemoveShellCommand(cmd)} className="hover:text-red-400 transition-colors">
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
                        className="flex-1 px-3 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <button
                        onClick={handleAddShellCommand}
                        disabled={!newShellCmd.trim()}
                        className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </section>

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
