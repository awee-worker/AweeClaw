/**
 * 编辑器设置组件
 */

import { Sparkles, Terminal, Settings2, Zap } from 'lucide-react'
import { TextField, DropdownSelector, ToggleSwitch } from '@components/ui'
import { EditorSettingsProps } from '../preferencesTypes'
import { t, type Language } from '@renderer/i18n'

// 预定义的触发字符选项
const TRIGGER_CHAR_OPTIONS = [
    { char: '.', label: '.' },
    { char: '(', label: '(' },
    { char: '{', label: '{' },
    { char: '[', label: '[' },
    { char: '"', label: '"' },
    { char: "'", label: "'" },
    { char: '/', label: '/' },
    { char: ' ', label: '␣' }, // 空格用特殊符号显示
    { char: ':', label: ':' },
    { char: '<', label: '<' },
    { char: '@', label: '@' },
    { char: '#', label: '#' },
]

export function EditorPreferencesPanel({ settings, setSettings, advancedConfig, setAdvancedConfig, language }: EditorSettingsProps) {
    const toggleTriggerChar = (char: string) => {
        const current = settings.completionTriggerChars
        if (current.includes(char)) {
            setSettings({ ...settings, completionTriggerChars: current.filter(c => c !== char) })
        } else {
            setSettings({ ...settings, completionTriggerChars: [...current, char] })
        }
    }

    // 通用 Section 样式类
    const sectionClass = "p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm hover:border-border transition-colors duration-300"
    const labelClass = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"
    const inputClass = "bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* Terminal Settings (Moved to Left) */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('settings.terminal', language as Language)}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className={labelClass}>{t('settings.fontsize', language as Language)}</label>
                                <TextField type="number" value={advancedConfig.terminal.fontSize} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, fontSize: parseInt(e.target.value) || 13 } })} min={10} max={24} className={inputClass} />
                            </div>
                            <div>
                                <label className={labelClass}>{t('settings.lineheight', language as Language)}</label>
                                <TextField type="number" value={advancedConfig.terminal.lineHeight} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, lineHeight: parseFloat(e.target.value) || 1.2 } })} min={1} max={2} step={0.1} className={inputClass} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelClass}>{t('settings.scrollbacklines', language as Language)}</label>
                                <TextField type="number" value={settings.terminalScrollback} onChange={(e) => setSettings({ ...settings, terminalScrollback: parseInt(e.target.value) || 1000 })} min={100} max={10000} step={100} className={inputClass} />
                            </div>
                        </div>
                        <div className="pt-2">
                            <ToggleSwitch label={t('settings.cursorblink', language as Language)} checked={advancedConfig.terminal.cursorBlink} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, cursorBlink: e.target.checked } })} />
                        </div>
                    </section>

                    {/* Features Switches */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('settings.features', language as Language)}</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <ToggleSwitch label={t('settings.showminimap', language as Language)} checked={settings.minimap} onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })} />
                            <ToggleSwitch label={t('settings.bracketpaircolorization', language as Language)} checked={settings.bracketPairColorization} onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })} />
                            <ToggleSwitch label={t('settings.formatonsave', language as Language)} checked={settings.formatOnSave} onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })} />
                        </div>

                        <div className="pt-4 border-t border-border/50">
                            <div className="flex items-center justify-between mb-4">
                                <label className={labelClass.replace('mb-2', 'mb-0')}>{t('settings.autosave', language as Language)}</label>
                                <DropdownSelector
                                    value={settings.autoSave}
                                    onChange={(value) => setSettings({ ...settings, autoSave: value as 'off' | 'afterDelay' | 'onFocusChange' })}
                                    options={[{ value: 'off', label: 'Off' }, { value: 'afterDelay', label: t('settings.afterdelay', language as Language) }, { value: 'onFocusChange', label: t('settings.onfocuschange', language as Language) }]}
                                    className={`w-40 ${inputClass}`}
                                />
                            </div>
                            {settings.autoSave === 'afterDelay' && (
                                <div className="flex items-center justify-between animate-scale-in pl-1">
                                    <label className="text-xs text-text-secondary">{t('settings.delayms', language as Language)}</label>
                                    <TextField
                                        type="number"
                                        value={settings.autoSaveDelay}
                                        onChange={(e) => setSettings({ ...settings, autoSaveDelay: parseInt(e.target.value) || 1000 })}
                                        min={500}
                                        max={10000}
                                        step={500}
                                        className={`w-28 h-8 ${inputClass}`}
                                    />
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* AI Completion */}
                    <section className="p-6 bg-gradient-to-br from-accent/5 to-transparent backdrop-blur-sm rounded-xl border border-accent/20 space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-accent" />
                                <h5 className="text-sm font-bold text-text-primary">{t('settings.aicompletion', language as Language)}</h5>
                            </div>
                            <ToggleSwitch checked={settings.completionEnabled} onChange={(e) => setSettings({ ...settings, completionEnabled: e.target.checked })} />
                        </div>

                        {settings.completionEnabled && (
                            <div className="space-y-5 pt-2 animate-scale-in">
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className={labelClass}>{t('settings.triggerdelay', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={settings.completionDebounceMs}
                                            onChange={(e) => setSettings({ ...settings, completionDebounceMs: parseInt(e.target.value) || 150 })}
                                            min={50}
                                            max={1000}
                                            step={50}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{t('settings.maxtokens', language as Language)}</label>
                                        <TextField
                                            type="number"
                                            value={settings.completionMaxTokens}
                                            onChange={(e) => setSettings({ ...settings, completionMaxTokens: parseInt(e.target.value) || 256 })}
                                            min={64}
                                            max={1024}
                                            step={64}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClass}>{t('settings.triggercharacters', language as Language)}</label>
                                    <div className="flex flex-wrap gap-2 p-3 bg-background/50 rounded-xl border border-border/50">
                                        {TRIGGER_CHAR_OPTIONS.map(({ char, label }) => {
                                            const isSelected = settings.completionTriggerChars.includes(char)
                                            return (
                                                <button
                                                    key={char}
                                                    type="button"
                                                    onClick={() => toggleTriggerChar(char)}
                                                    className={`w-8 h-8 rounded-lg text-sm font-mono flex items-center justify-center transition-all duration-200 ${isSelected
                                                        ? 'bg-accent text-white shadow-md shadow-accent/20 scale-105'
                                                        : 'bg-surface hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border/50'
                                                        }`}
                                                    title={char === ' ' ? 'Space' : char}
                                                >
                                                    {label}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <p className="text-[11px] text-text-muted mt-2 ml-1">
                                        {t('settings.dropdownselectorcharactersthattriggerai', language as Language)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Git Settings */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">Git</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <ToggleSwitch
                                label={t('settings.autorefreshgitstatus', language as Language)}
                                checked={advancedConfig.git?.autoRefresh ?? true}
                                onChange={(e) => setAdvancedConfig({ ...advancedConfig, git: { ...advancedConfig.git, autoRefresh: e.target.checked } })}
                            />
                            <p className="text-[11px] text-text-muted opacity-80 leading-relaxed">
                                {t('settings.automaticallyrefreshgitindicatorswhen', language as Language)}
                            </p>
                        </div>
                    </section>

                    {/* Performance */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('settings.performance', language as Language)}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.largefilewarningmb', language as Language)}</label>
                                <TextField type="number" value={settings.largeFileWarningThresholdMB} onChange={(e) => setSettings({ ...settings, largeFileWarningThresholdMB: parseFloat(e.target.value) || 5 })} min={1} max={50} step={1} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.largefilelinecount', language as Language)}</label>
                                <TextField type="number" value={settings.largeFileLineCount} onChange={(e) => setSettings({ ...settings, largeFileLineCount: parseInt(e.target.value) || 10000 })} min={1000} max={100000} step={1000} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.commandtimeouts', language as Language)}</label>
                                <TextField type="number" value={settings.commandTimeoutMs / 1000} onChange={(e) => setSettings({ ...settings, commandTimeoutMs: (parseInt(e.target.value) || 30) * 1000 })} min={10} max={300} step={10} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.maxprojectfiles', language as Language)}</label>
                                <TextField type="number" value={settings.maxProjectFiles} onChange={(e) => setSettings({ ...settings, maxProjectFiles: parseInt(e.target.value) || 500 })} min={100} max={2000} step={100} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.filetreemaxdepth', language as Language)}</label>
                                <TextField type="number" value={settings.maxFileTreeDepth} onChange={(e) => setSettings({ ...settings, maxFileTreeDepth: parseInt(e.target.value) || 5 })} min={2} max={15} step={1} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{t('settings.maxsearchresults', language as Language)}</label>
                                <TextField type="number" value={settings.maxSearchResults} onChange={(e) => setSettings({ ...settings, maxSearchResults: parseInt(e.target.value) || 1000 })} min={100} max={5000} step={100} className={inputClass} />
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
