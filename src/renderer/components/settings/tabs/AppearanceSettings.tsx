import { Layout, Check, Sun, Moon, Monitor, Globe, Type, MessageSquare } from 'lucide-react'
import { useStore, type ThemeName, type ThemeMode, type ThemeColor } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager, THEME_COLOR_OPTIONS } from '@/renderer/config/themeDefinition'
import { api } from '../../../adapters/electronBridge'
import { EditorSettingsProps } from '../preferencesTypes'
import { LANGUAGES } from '../preferencesTypes'
import { ToggleSwitch } from '@components/ui'
import type { AgentConfig } from '@shared/configuration/configTypes'

import { useEffect, useCallback, useMemo } from 'react'
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

export function AppearanceSettings({ settings, setSettings, language, localLanguage, setLocalLanguage, agentConfig, setAgentConfig }: EditorSettingsProps & {
    /** Agent 配置（用于对话展示偏好 expand*ByDefault，从 AgentProfilePanel 迁入） */
    agentConfig?: AgentConfig
    setAgentConfig?: (config: AgentConfig) => void
}) {
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
        applyThemeForModeAndColor(themeMode, themeColor)
    }, [])

    // 当前生效的类型（system 模式下取系统偏好）
    const effectiveType: 'light' | 'dark' = themeMode === 'system'
        ? (systemPrefersDark ? 'dark' : 'light')
        : themeMode

    const labelClass = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"

    // ============================================
    // 字体大小档位定义
    // ============================================
    // 同时控制编辑器（fontSize）和聊天区域（chatFontSize）。
    // 偏小：紧凑，单屏可见更多内容
    // 适中：默认舒适阅读
    // 偏大：长时间阅读更舒适
    // 超大：视力友好或演示场景
    type FontScaleKey = 'small' | 'medium' | 'large' | 'xlarge'
    const FONT_SCALE_OPTIONS: {
        key: FontScaleKey
        editorSize: number
        chatSize: number
        labelZh: string
        labelEn: string
        descZh: string
        descEn: string
        // 卡片预览字符的渲染字号
        previewSize: number
    }[] = [
        {
            key: 'small',
            editorSize: 12,
            chatSize: 13,
            labelZh: '偏小',
            labelEn: 'Small',
            descZh: '紧凑布局，单屏显示更多内容',
            descEn: 'Compact layout, more content per screen',
            previewSize: 13,
        },
        {
            key: 'medium',
            editorSize: 14,
            chatSize: 15,
            labelZh: '适中',
            labelEn: 'Medium',
            descZh: '默认阅读体验，平衡舒适与效率',
            descEn: 'Default experience, balanced comfort',
            previewSize: 16,
        },
        {
            key: 'large',
            editorSize: 16,
            chatSize: 17,
            labelZh: '偏大',
            labelEn: 'Large',
            descZh: '长时间阅读更轻松',
            descEn: 'Easier for extended reading',
            previewSize: 19,
        },
        {
            key: 'xlarge',
            editorSize: 18,
            chatSize: 20,
            labelZh: '超大',
            labelEn: 'Extra Large',
            descZh: '视力友好，适合演示场景',
            descEn: 'Vision-friendly, great for demos',
            previewSize: 23,
        },
    ]

    // 根据当前 chatFontSize 反推激活档位
    const activeFontScale: FontScaleKey = useMemo(() => {
        const chat = settings.chatFontSize
        if (chat <= 13) return 'small'
        if (chat >= 20) return 'xlarge'
        if (chat >= 17) return 'large'
        return 'medium'
    }, [settings.chatFontSize])

    const handleFontScaleChange = useCallback((opt: typeof FONT_SCALE_OPTIONS[number]) => {
        setSettings({
            ...settings,
            fontSize: opt.editorSize,
            chatFontSize: opt.chatSize,
        })
    }, [settings, setSettings])

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            {localLanguage && setLocalLanguage && (
                <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 rounded-md bg-accent/10">
                            <Globe className="w-4 h-4 text-accent" />
                        </div>
                        <h4 className="text-sm font-bold text-text-primary tracking-tight">
                            {t('settings.interfacelanguage', language as Language)}
                        </h4>
                    </div>

                    <p className="text-sm text-text-muted mb-4">
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

            <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-4">
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

            <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Type className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '字体大小' : 'Font Size'}
                    </h4>
                </div>

                <p className="text-sm text-text-muted mb-4">
                    {language === 'zh'
                        ? '选择界面与对话内容的字体大小，编辑器与聊天区域将同步调整。'
                        : 'Choose the font size for the UI and conversations. Editor and chat area will both adapt.'}
                </p>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {FONT_SCALE_OPTIONS.map(opt => {
                        const isActive = activeFontScale === opt.key
                        return (
                            <button
                                key={opt.key}
                                type="button"
                                onClick={() => handleFontScaleChange(opt)}
                                className={`group relative p-5 rounded-xl border text-left transition-all duration-300 cursor-pointer overflow-hidden ${
                                    isActive
                                        ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                        : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                }`}
                            >
                                {/* 角标勾选 */}
                                {isActive && (
                                    <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                    </div>
                                )}

                                {/* 可视化预览：用对应档位字号渲染字符，直观感知大小差异 */}
                                <div
                                    className="flex items-baseline gap-1 mb-3 leading-none"
                                    style={{ fontSize: `${opt.previewSize}px` }}
                                >
                                    <span className="font-bold text-text-primary">字</span>
                                    <span className="font-semibold text-text-secondary" style={{ fontSize: `${opt.previewSize * 0.7}px` }}>Aa</span>
                                </div>

                                {/* 档位名称 */}
                                <div className={`text-sm font-semibold transition-colors ${isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                    {language === 'zh' ? opt.labelZh : opt.labelEn}
                                </div>

                                {/* 像素副标题 */}
                                <div className="text-[11px] text-text-muted mt-0.5 font-mono">
                                    {opt.editorSize}/{opt.chatSize}px
                                </div>

                                {/* 描述 */}
                                <div className="text-[11px] text-text-muted mt-2 leading-relaxed line-clamp-2">
                                    {language === 'zh' ? opt.descZh : opt.descEn}
                                </div>
                            </button>
                        )
                    })}
                </div>
            </section>

            {/* 对话展示（从 AgentProfilePanel 迁入） */}
            {agentConfig && setAgentConfig && (
                <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 rounded-md bg-accent/10">
                            <MessageSquare className="w-4 h-4 text-accent" />
                        </div>
                        <h4 className="text-sm font-bold text-text-primary tracking-tight">
                            {language === 'zh' ? '对话展示' : 'Conversation Display'}
                        </h4>
                    </div>

                    <p className="text-sm text-text-muted mb-4">
                        {language === 'zh'
                            ? '控制对话消息中思考、工具调用、上下文等区块的默认展开状态。'
                            : 'Control the default expand state of thinking, tool calls, and context blocks in conversation messages.'}
                    </p>

                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                        <ToggleSwitch
                            label={language === 'zh' ? '默认展开思考块' : 'Expand thinking by default'}
                            checked={agentConfig.expandThinkingByDefault}
                            onChange={(e) => setAgentConfig({ ...agentConfig, expandThinkingByDefault: e.target.checked })}
                        />
                        <ToggleSwitch
                            label={language === 'zh' ? '默认展开工具调用' : 'Expand tool calls by default'}
                            checked={agentConfig.expandToolCallsByDefault}
                            onChange={(e) => setAgentConfig({ ...agentConfig, expandToolCallsByDefault: e.target.checked })}
                        />
                        <ToggleSwitch
                            label={language === 'zh' ? '默认展开上下文块' : 'Expand context by default'}
                            checked={agentConfig.expandContextByDefault}
                            onChange={(e) => setAgentConfig({ ...agentConfig, expandContextByDefault: e.target.checked })}
                        />
                    </div>
                </section>
            )}
        </div>
    )
}
