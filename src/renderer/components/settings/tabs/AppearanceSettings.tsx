import { Layout, Type, Check, Sun, Moon, Monitor, Globe } from 'lucide-react'
import { useStore, type ThemeName, type ThemeMode, type ThemeColor } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager, THEME_COLOR_OPTIONS } from '@/renderer/config/themeDefinition'
import { api } from '../../../adapters/electronBridge'
import { TextField, DropdownSelector } from '@components/ui'
import { EditorSettingsProps } from '../preferencesTypes'
import { LANGUAGES } from '../preferencesTypes'

import { useEffect, useCallback } from 'react'
import { t, type Language } from '@renderer/i18n'

const LANGUAGE_META: Record<Language, { labelZh: string; labelEn: string; descriptionZh: string; descriptionEn: string; flag: string }> = {
    zh: {
        labelZh: '中文',
        labelEn: 'Chinese',
        descriptionZh: '界面文字显示为简体中文',
        descriptionEn: 'Display interface in Simplified Chinese',
        flag: '🇨🇳',
    },
    en: {
        labelZh: 'English',
        labelEn: 'English',
        descriptionZh: '界面文字显示为英文',
        descriptionEn: 'Display interface in English',
        flag: '🇺🇸',
    },
}

const THEME_MODE_OPTIONS: { value: ThemeMode; labelZh: string; labelEn: string; icon: typeof Sun }[] = [
    { value: 'light', labelZh: '亮色', labelEn: 'Light', icon: Sun },
    { value: 'dark', labelZh: '暗色', labelEn: 'Dark', icon: Moon },
    { value: 'system', labelZh: '跟随系统', labelEn: 'System', icon: Monitor },
]

export function AppearanceSettings({ settings, setSettings, language, localLanguage, setLocalLanguage }: EditorSettingsProps) {
    const { setTheme, themeMode, setThemeMode, themeColor, setThemeColor, systemPrefersDark, setSystemPrefersDark } = useStore(useShallow(s => ({
        setTheme: s.setTheme,
        themeMode: s.themeMode,
        setThemeMode: s.setThemeMode,
        themeColor: s.themeColor,
        setThemeColor: s.setThemeColor,
        systemPrefersDark: s.systemPrefersDark,
        setSystemPrefersDark: s.setSystemPrefersDark,
    })))

    // 根据模式 + 颜色应用主题
    const applyThemeForModeAndColor = useCallback((mode: ThemeMode, color: ThemeColor) => {
        const resolvedTheme = themeManager.resolveThemeByModeAndColor(mode, color)
        setTheme(resolvedTheme.id as ThemeName)
        themeManager.setTheme(resolvedTheme.id)
        api.settings.set('themeId', resolvedTheme.id)
    }, [setTheme])

    const handleThemeModeChange = useCallback((mode: ThemeMode) => {
        setThemeMode(mode)
        applyThemeForModeAndColor(mode, themeColor)
    }, [setThemeMode, applyThemeForModeAndColor, themeColor])

    const handleThemeColorChange = useCallback((color: ThemeColor) => {
        setThemeColor(color)
        applyThemeForModeAndColor(themeMode, color)
    }, [setThemeColor, applyThemeForModeAndColor, themeMode])

    useEffect(() => {
        if (themeMode !== 'system') {
            themeManager.stopSystemThemeListener()
            return
        }

        themeManager.startSystemThemeListener((isDark) => {
            setSystemPrefersDark(isDark)
            applyThemeForModeAndColor('system', themeColor)
        })

        return () => {
            themeManager.stopSystemThemeListener()
        }
    }, [themeMode, themeColor, applyThemeForModeAndColor, setSystemPrefersDark])

    useEffect(() => {
        if (themeMode === 'system') {
            applyThemeForModeAndColor('system', themeColor)
        }
    }, [])

    // 当前生效的类型（system 模式下取系统偏好）
    const effectiveType: 'light' | 'dark' = themeMode === 'system'
        ? (systemPrefersDark ? 'dark' : 'light')
        : themeMode

    const sectionClass = "p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm hover:border-border transition-colors duration-300"
    const labelClass = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"
    const inputClass = "bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            {localLanguage && setLocalLanguage && (
                <section>
                    <div className="flex items-center gap-2 mb-5 ml-1">
                        <div className="p-1.5 rounded-md bg-accent/10">
                            <Globe className="w-4 h-4 text-accent" />
                        </div>
                        <h4 className="text-sm font-bold text-text-primary tracking-tight">
                            {t('settings.interfacelanguage', language as Language)}
                        </h4>
                    </div>

                    <p className="text-sm text-text-muted mb-4 ml-1">
                        {t('settings.chooseyourpreferredinterfacelanguage', language as Language)}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {LANGUAGES.map(item => {
                            const meta = LANGUAGE_META[item.id]
                            const isActive = localLanguage === item.id
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setLocalLanguage(item.id)}
                                    className={`group relative p-4 rounded-xl border text-left transition-all duration-300 ${
                                        isActive
                                            ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                            : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="text-2xl leading-none">{meta.flag}</span>
                                        <div className="flex-1 min-w-0">
                                            <span className={`text-sm font-semibold block truncate transition-colors ${isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                                {language === 'zh' ? meta.labelZh : meta.labelEn}
                                            </span>
                                            <span className="text-xs text-text-muted mt-0.5 block">
                                                {language === 'zh' ? meta.descriptionZh : meta.descriptionEn}
                                            </span>
                                        </div>
                                    </div>
                                    {isActive && (
                                        <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </section>
            )}

            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Layout className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {t('settings.appearancetheme', language as Language)}
                    </h4>
                </div>

                {/* 主题模式：亮色 / 暗色 / 跟随系统 */}
                <div className="mb-6">
                    <label className={labelClass}>
                        {t('settings.thememode', language as Language)}
                    </label>
                    <div className="flex gap-2">
                        {THEME_MODE_OPTIONS.map(opt => {
                            const Icon = opt.icon
                            const isActive = themeMode === opt.value
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => handleThemeModeChange(opt.value)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                                        isActive
                                            ? 'border-accent bg-accent/10 text-accent shadow-sm'
                                            : 'border-border/50 bg-surface/30 text-text-secondary hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span>{language === 'zh' ? opt.labelZh : opt.labelEn}</span>
                                </button>
                            )
                        })}
                    </div>
                    {themeMode === 'system' && (
                        <p className="text-[11px] text-text-muted mt-2 ml-1">
                            {t('settings.systempreferencethemeappliedautomatically', language as Language, { p0: systemPrefersDark ? 'Dark' : 'Light', p1: systemPrefersDark ? '暗色' : '亮色' })}
                        </p>
                    )}
                </div>

                {/* 主题颜色：4种颜色，根据当前生效类型显示对应预览 */}
                <div>
                    <label className={labelClass}>
                        {t('settings.themecolor', language as Language)}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {THEME_COLOR_OPTIONS.map(colorOpt => {
                            const theme = themeManager.resolveThemeByModeAndColor(effectiveType, colorOpt.value)
                            const isActive = themeColor === colorOpt.value
                            const themeVars = theme.colors
                            return (
                                <button
                                    key={colorOpt.value}
                                    onClick={() => handleThemeColorChange(colorOpt.value)}
                                    className={`group relative p-3 rounded-xl border text-left transition-all duration-300 overflow-hidden ${
                                        isActive
                                            ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                            : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex gap-2">
                                            <div className="w-7 h-7 rounded-full shadow-md ring-2 ring-white/10" style={{ backgroundColor: `rgb(${themeVars.background})` }} title="Background" />
                                            <div className="w-7 h-7 rounded-full shadow-md ring-2 ring-white/10" style={{ backgroundColor: `rgb(${themeVars.accent})` }} title="Accent" />
                                        </div>
                                        {isActive && (
                                            <div className="bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                                <Check className="w-3 h-3 text-white" strokeWidth={3} />
                                            </div>
                                        )}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className={sectionClass}>
                    <div className="flex items-center gap-2 mb-1">
                        <Type className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-bold text-text-primary">{t('settings.typographylayout', language as Language)}</h5>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                        <div>
                            <label className={labelClass}>{t('settings.fontsize', language as Language)}</label>
                            <TextField
                                type="number"
                                value={settings.fontSize}
                                onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })}
                                min={10}
                                max={32}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{t('settings.tabsize', language as Language)}</label>
                            <DropdownSelector
                                value={settings.tabSize.toString()}
                                onChange={(value) => setSettings({ ...settings, tabSize: parseInt(value) })}
                                options={[{ value: '2', label: '2 Spaces' }, { value: '4', label: '4 Spaces' }, { value: '8', label: '8 Spaces' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{t('settings.wordwrap', language as Language)}</label>
                            <DropdownSelector
                                value={settings.wordWrap}
                                onChange={(value) => setSettings({ ...settings, wordWrap: value as 'on' | 'off' | 'wordWrapColumn' })}
                                options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'Column' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{t('settings.linenumbers', language as Language)}</label>
                            <DropdownSelector
                                value={settings.lineNumbers}
                                onChange={(value) => setSettings({ ...settings, lineNumbers: value as 'on' | 'off' | 'relative' })}
                                options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                    </div>
                </section>

                <section className={sectionClass}>
                    <div className="flex items-center gap-2 mb-1">
                        <Type className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-bold text-text-primary">{t('settings.agentchatarea', language as Language)}</h5>
                    </div>
                    <div>
                        <label className={labelClass}>{t('settings.fontsize2', language as Language)}</label>
                        <TextField
                            type="number"
                            value={settings.chatFontSize}
                            onChange={(e) => setSettings({ ...settings, chatFontSize: parseInt(e.target.value) || 14 })}
                            min={10}
                            max={32}
                            className={inputClass}
                        />
                    </div>
                </section>
            </div>
        </div>
    )
}
