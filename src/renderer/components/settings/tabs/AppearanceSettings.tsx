import { Layout, Check, Sun, Moon, Monitor, Globe, Type, MessageSquare, Code2, Circle, Image, RotateCcw, Upload, Link2, Plus, Pencil, Trash2, X } from 'lucide-react'
import { useStore, type ThemeName, type ThemeMode, type ThemeColor } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager, THEME_COLOR_OPTIONS } from '@/renderer/config/themeDefinition'
import {
    BUILTIN_WALLPAPERS,
    DEFAULT_WALLPAPER_TUNING,
    getBuiltinWallpaper,
    isSameWallpaperConfig,
    resolveWallpaperImage,
    type CustomWallpaperTheme,
    type WallpaperConfig,
    type WallpaperFit,
} from '@/renderer/config/wallpaper'
import { api } from '../../../adapters/electronBridge'
import { EditorSettingsProps } from '../preferencesTypes'
import { LANGUAGES } from '../preferencesTypes'
import { ToggleSwitch } from '@components/ui'
import type { AgentConfig } from '@shared/configuration/configTypes'

import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { t, type Language } from '@renderer/i18n'
import { FloatingAvatarSettings } from './FloatingAvatarSettings'

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

export function AppearanceSettings({ settings, setSettings, language, localLanguage, setLocalLanguage, applyLanguageImmediately, agentConfig, setAgentConfig }: EditorSettingsProps & {
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

    // ============================================
    // 壁纸状态
    // ============================================
    // userWallpaper：用户自定义背景，null 表示跟随主题自带壁纸
    const [userWallpaper, setUserWallpaperState] = useState<WallpaperConfig | null>(
        () => themeManager.getUserWallpaper()
    )
    const [activeWallpaper, setActiveWallpaperState] = useState<WallpaperConfig | null>(
        () => themeManager.getActiveWallpaper()
    )
    // 折叠与图片来源面板
    // 图片来源面板的展开状态
    const [imageUrlDraft, setImageUrlDraft] = useState('')
    const [wallpaperError, setWallpaperError] = useState('')
    // 滑块拖动期间只改 DOM，停止输入后再落盘，避免 IPC 写入风暴
    const saveWallpaperTimer = useRef<number | null>(null)

    const syncWallpaperState = useCallback(() => {
        setUserWallpaperState(themeManager.getUserWallpaper())
        setActiveWallpaperState(themeManager.getActiveWallpaper())
    }, [])

    /** 落盘：设置用户自定义壁纸，传 null 恢复主题自带 */
    const commitWallpaper = useCallback((next: WallpaperConfig | null) => {
        themeManager.setUserWallpaper(next)
        syncWallpaperState()
    }, [syncWallpaperState])

    /** 预览：只改变 DOM，不写配置 */
    const previewWallpaper = useCallback((next: WallpaperConfig | null) => {
        themeManager.previewWallpaper(next)
        setUserWallpaperState(next)
    }, [])

    /** 滑块变更：先预览，停止操作 320ms 后落盘 */
    const scheduleWallpaperSave = useCallback((next: WallpaperConfig) => {
        previewWallpaper(next)
        if (saveWallpaperTimer.current) window.clearTimeout(saveWallpaperTimer.current)
        saveWallpaperTimer.current = window.setTimeout(() => {
            commitWallpaper(next)
        }, 320)
    }, [previewWallpaper, commitWallpaper])

    useEffect(() => () => {
        if (saveWallpaperTimer.current) window.clearTimeout(saveWallpaperTimer.current)
    }, [])

    // 根据模式 + 颜色应用主题
    const applyThemeForModeAndColor = useCallback((mode: ThemeMode, color: ThemeColor) => {
        const resolvedTheme = themeManager.resolveThemeByModeAndColor(mode, color)
        setTheme(resolvedTheme.id as ThemeName)
        themeManager.setTheme(resolvedTheme.id)
        api.settings.set('themeId', resolvedTheme.id)
        // 主题自带的推荐壁纸会跟着换，需要同步面板上的壁纸状态
        setActiveWallpaperState(themeManager.getActiveWallpaper())
    }, [setTheme])

    const handleThemeModeChange = useCallback((mode: ThemeMode) => {
        setThemeMode(mode)
        applyThemeForModeAndColor(mode, themeColor)
    }, [setThemeMode, applyThemeForModeAndColor, themeColor])

    const handleThemeColorChange = useCallback((color: ThemeColor) => {
        setThemeColor(color)
        applyThemeForModeAndColor(themeMode, color)
    }, [setThemeColor, applyThemeForModeAndColor, themeMode])

    // ============================================
    // 壁纸操作
    // ============================================

    /** 用当前生效壁纸的调参作为基底，避免切换图片时把用户调好的模糊度重置 */
    const wallpaperTuningBase = useCallback(() => ({
        blur: activeWallpaper?.blur ?? DEFAULT_WALLPAPER_TUNING.blur,
        dim: activeWallpaper?.dim ?? DEFAULT_WALLPAPER_TUNING.dim,
        panelAlpha: activeWallpaper?.panelAlpha ?? DEFAULT_WALLPAPER_TUNING.panelAlpha,
        fit: activeWallpaper?.fit ?? DEFAULT_WALLPAPER_TUNING.fit,
    }), [activeWallpaper])

    const handlePickBuiltin = useCallback((id: string) => {
        setWallpaperError('')
        // 壁纸就是页面底色，正文配色必须与它同明暗：选了亮色壁纸却停在暗色主题，
        // 浅底配浅字，正文与按钮几乎不可见。这里直接跟着壁纸切一次明暗，
        // 用户不必再回上面手动切换。
        const builtin = getBuiltinWallpaper(id)
        if (builtin && builtin.themeType !== themeManager.getCurrentTheme().type) {
            setThemeMode(builtin.themeType)
            applyThemeForModeAndColor(builtin.themeType, themeColor)
        }
        commitWallpaper({ id, kind: 'builtin', ...wallpaperTuningBase() })
    }, [commitWallpaper, wallpaperTuningBase, applyThemeForModeAndColor, themeColor, setThemeMode])

    const handlePickLocalImage = useCallback(async () => {
        setWallpaperError('')
        const result = await api.wallpaper.pick()
        if (!result.ok) {
            if (result.reason === 'too-large') {
                setWallpaperError(language === 'zh' ? '图片超过 30MB，请压缩后再试' : 'Image exceeds 30MB, please compress it first')
            } else if (result.reason === 'unsupported-format') {
                setWallpaperError(language === 'zh' ? '仅支持 PNG / JPG / WEBP / BMP' : 'Only PNG / JPG / WEBP / BMP are supported')
            } else if (result.reason !== 'canceled') {
                setWallpaperError(language === 'zh' ? '图片导入失败，请重试' : 'Failed to import the image')
            }
            return
        }
        commitWallpaper({ id: 'custom', kind: 'image', url: result.url, ...wallpaperTuningBase() })
    }, [language, commitWallpaper, wallpaperTuningBase])

    const handleApplyImageUrl = useCallback(() => {
        const url = imageUrlDraft.trim()
        if (!/^https?:\/\//i.test(url)) {
            setWallpaperError(language === 'zh' ? '请输入以 http(s) 开头的图片地址' : 'Enter an image URL starting with http(s)')
            return
        }
        setWallpaperError('')
        commitWallpaper({ id: 'custom', kind: 'image', url, ...wallpaperTuningBase() })
        setImageUrlDraft('')
    }, [imageUrlDraft, language, commitWallpaper, wallpaperTuningBase])

    const handleResetWallpaper = useCallback(() => {
        setWallpaperError('')
        commitWallpaper(null)
    }, [commitWallpaper])

    const handleWallpaperTuning = useCallback((patch: Partial<WallpaperConfig>) => {
        if (!activeWallpaper) return
        scheduleWallpaperSave({ ...activeWallpaper, ...patch })
    }, [activeWallpaper, scheduleWallpaperSave])

    // ============================================
    // 自定义壁纸主题（壁纸 + 滑块参数 + 明暗配色）
    // ============================================

    const [customWallpaperThemes, setCustomWallpaperThemesState] = useState<CustomWallpaperTheme[]>(
        () => themeManager.getCustomWallpaperThemes()
    )
    /** 新建主题的名称草稿；null 表示输入框未展开 */
    const [newThemeName, setNewThemeName] = useState<string | null>(null)
    /** 正在重命名的主题 id 与草稿名 */
    const [editingTheme, setEditingTheme] = useState<{ id: string; name: string } | null>(null)
    /** 等待二次确认删除的主题 id */
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

    const syncCustomWallpaperThemes = useCallback(() => {
        setCustomWallpaperThemesState(themeManager.getCustomWallpaperThemes())
    }, [])

    /** 当前配色对应的 ColorTheme id，用于随壁纸一起存档 */
    const currentColorThemeId = useMemo(
        () => themeManager.getColorThemeByColor(themeColor)?.id ?? 'aweeclaw',
        [themeColor]
    )

    /** 新建时给一个可读的默认名，避免用户必须先想名字 */
    const defaultThemeName = useMemo(
        () => language === 'zh'
            ? `壁纸主题 ${customWallpaperThemes.length + 1}`
            : `Wallpaper theme ${customWallpaperThemes.length + 1}`,
        [language, customWallpaperThemes.length]
    )

    const handleStartSaveTheme = useCallback(() => {
        if (!activeWallpaper) return
        setEditingTheme(null)
        setPendingDeleteId(null)
        setNewThemeName(defaultThemeName)
    }, [activeWallpaper, defaultThemeName])

    const handleConfirmSaveTheme = useCallback(() => {
        if (!activeWallpaper || newThemeName === null) return
        const saved = themeManager.saveCustomWallpaperTheme({
            name: newThemeName.trim() || defaultThemeName,
            wallpaper: activeWallpaper,
            themeMode,
            colorThemeId: currentColorThemeId,
        })
        if (!saved) return
        setNewThemeName(null)
        syncCustomWallpaperThemes()
    }, [activeWallpaper, newThemeName, defaultThemeName, themeMode, currentColorThemeId, syncCustomWallpaperThemes])

    /** 应用一套自定义壁纸主题：壁纸、滑块参数、明暗模式与配色一起恢复 */
    const handleApplyCustomTheme = useCallback((preset: CustomWallpaperTheme) => {
        setWallpaperError('')
        const color = themeManager.getColorThemeById(preset.colorThemeId)?.color
            ?? themeManager.resolveColorFromThemeId(preset.colorThemeId)
        setThemeColor(color)
        setThemeMode(preset.themeMode)
        applyThemeForModeAndColor(preset.themeMode, color)
        commitWallpaper(preset.wallpaper)
    }, [applyThemeForModeAndColor, setThemeColor, setThemeMode, commitWallpaper])

    const handleRenameTheme = useCallback(() => {
        if (!editingTheme) return
        const preset = themeManager.getCustomWallpaperTheme(editingTheme.id)
        if (!preset) return
        themeManager.saveCustomWallpaperTheme({
            id: preset.id,
            name: editingTheme.name.trim() || preset.name,
            wallpaper: preset.wallpaper,
            themeMode: preset.themeMode,
            colorThemeId: preset.colorThemeId,
        })
        setEditingTheme(null)
        syncCustomWallpaperThemes()
    }, [editingTheme, syncCustomWallpaperThemes])

    /** 用当前壁纸与主题设置覆盖已有主题 */
    const handleOverwriteTheme = useCallback((preset: CustomWallpaperTheme) => {
        if (!activeWallpaper) return
        themeManager.saveCustomWallpaperTheme({
            id: preset.id,
            name: editingTheme?.id === preset.id ? (editingTheme.name.trim() || preset.name) : preset.name,
            wallpaper: activeWallpaper,
            themeMode,
            colorThemeId: currentColorThemeId,
        })
        setEditingTheme(null)
        syncCustomWallpaperThemes()
    }, [activeWallpaper, editingTheme, themeMode, currentColorThemeId, syncCustomWallpaperThemes])

    const handleDeleteTheme = useCallback((themeId: string) => {
        themeManager.removeCustomWallpaperTheme(themeId)
        if (editingTheme?.id === themeId) setEditingTheme(null)
        setPendingDeleteId(null)
        syncCustomWallpaperThemes()
    }, [editingTheme, syncCustomWallpaperThemes])

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

    /** 当前生效壁纸的可读名称，用于状态行 */
    const activeWallpaperName = useMemo(() => {
        if (!activeWallpaper) return language === 'zh' ? '无背景图' : 'No wallpaper'
        if (activeWallpaper.kind === 'image') return language === 'zh' ? '自定义图片' : 'Custom image'
        const builtin = BUILTIN_WALLPAPERS.find(wp => wp.id === activeWallpaper.id)
        if (!builtin) return activeWallpaper.id
        return language === 'zh' ? builtin.nameZh : builtin.nameEn
    }, [activeWallpaper, language])

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
            {localLanguage && (setLocalLanguage || applyLanguageImmediately) && (
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
                                    onClick={() => {
                                        // 阶段7 s7-09：优先使用运行时切换（立即生效），fallback 到本地状态编辑
                                        if (applyLanguageImmediately) {
                                            applyLanguageImmediately(item.id)
                                        } else if (setLocalLanguage) {
                                            setLocalLanguage(item.id)
                                        }
                                    }}
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
                            {t('settings.systempreferencethemeappliedautomatically', language as Language, {
                                preference: systemPrefersDark
                                    ? (language === 'zh' ? '暗色' : 'Dark')
                                    : (language === 'zh' ? '亮色' : 'Light'),
                            })}
                        </p>
                    )}
                </div>

                {/* 预设主题：每套配色一张卡，带壁纸的主题直接铺壁纸预览 */}
                <div>
                    <label className={labelClass}>
                        {t('settings.themecolor', language as Language)}
                    </label>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {THEME_COLOR_OPTIONS.map(colorOpt => {
                            const theme = themeManager.resolveThemeByModeAndColor(effectiveType, colorOpt.value)
                            const isActive = themeColor === colorOpt.value
                            const themeVars = theme.colors
                            const wallpaperImage = resolveWallpaperImage(theme.wallpaper)
                            return (
                                <button
                                    key={colorOpt.value}
                                    onClick={() => handleThemeColorChange(colorOpt.value)}
                                    className={`group relative rounded-xl border text-left transition-all duration-300 overflow-hidden ${
                                        isActive
                                            ? 'border-accent shadow-lg shadow-accent/10 ring-1 ring-accent/20'
                                            : 'border-border/50 hover:border-accent/30 hover:bg-surface/40'
                                    }`}
                                >
                                    <div
                                        className="relative h-20 w-full"
                                        style={{
                                            backgroundColor: `rgb(${themeVars.background})`,
                                            backgroundImage: wallpaperImage || undefined,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                        }}
                                    >
                                        <div
                                            className="absolute left-0 top-0 h-full w-9"
                                            style={{ backgroundColor: `rgb(${themeVars.surface})` }}
                                        />
                                        <div
                                            className="absolute left-12 top-4 h-1.5 w-10 rounded-full"
                                            style={{ backgroundColor: `rgb(${themeVars.accent})` }}
                                        />
                                        <div
                                            className="absolute left-12 top-8 h-1 w-16 rounded-full"
                                            style={{ backgroundColor: `rgb(${themeVars.textMuted})`, opacity: 0.55 }}
                                        />
                                        <div
                                            className="absolute left-12 top-11 h-1 w-12 rounded-full"
                                            style={{ backgroundColor: `rgb(${themeVars.textMuted})`, opacity: 0.35 }}
                                        />
                                        {wallpaperImage && (
                                            <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                <Image className="w-2.5 h-2.5" />
                                                {language === 'zh' ? '壁纸' : 'Wallpaper'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                                        <div className="min-w-0">
                                            <span className="block text-xs font-semibold text-text-primary truncate">
                                                {language === 'zh' ? colorOpt.labelZh : colorOpt.labelEn}
                                            </span>
                                            <span className="mt-0.5 block text-[10px] leading-tight text-text-muted">
                                                {language === 'zh' ? colorOpt.descZh : colorOpt.descEn}
                                            </span>
                                        </div>
                                        {isActive && (
                                            <div className="shrink-0 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
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

            {/* 背景壁纸：内置壁纸 / 本地图片 / 图片地址 / 显示参数 */}
            <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Image className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '背景壁纸' : 'Background Wallpaper'}
                    </h4>
                </div>

                <p className="text-sm text-text-muted mb-4">
                    {language === 'zh'
                        ? '给界面铺一层背景图。内置壁纸与主题配套，也可以换成自己的图片；模糊和遮罩用来保住文字的可读性。'
                        : 'Put an image behind the interface. Built-in wallpapers ship with themes; you can also use your own. Blur and dim keep text readable.'}
                </p>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/30 px-4 py-3 mb-4">
                    <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-text-primary">
                            {activeWallpaperName}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-muted">
                            {userWallpaper
                                ? (language === 'zh' ? '自定义背景' : 'Custom background')
                                : (language === 'zh' ? '跟随主题推荐' : 'Following theme')}
                        </div>
                    </div>
                    <button
                        onClick={handleResetWallpaper}
                        disabled={!userWallpaper}
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            userWallpaper
                                ? 'border-border/60 text-text-secondary hover:border-accent/40 hover:text-accent'
                                : 'cursor-not-allowed border-border/30 text-text-muted/50'
                        }`}
                    >
                        <RotateCcw className="w-3 h-3" />
                        {language === 'zh' ? '恢复主题默认' : 'Reset to theme'}
                    </button>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-4">
                    {BUILTIN_WALLPAPERS.map(wp => {
                        const isActive = activeWallpaper?.kind === 'builtin' && activeWallpaper.id === wp.id
                        return (
                            <button
                                key={wp.id}
                                onClick={() => handlePickBuiltin(wp.id)}
                                className={`relative overflow-hidden rounded-lg border transition-all ${
                                    isActive
                                        ? 'border-accent ring-1 ring-accent/30'
                                        : 'border-border/50 hover:border-accent/40'
                                }`}
                            >
                                <div
                                    className="h-12 w-full"
                                    style={{
                                        backgroundColor: wp.previewBg,
                                        backgroundImage: wp.css,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                />
                                <span className="block truncate px-1.5 py-1 text-[10px] text-text-secondary">
                                    {language === 'zh' ? wp.nameZh : wp.nameEn}
                                </span>
                                {isActive && (
                                    <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5">
                                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={handlePickLocalImage}
                        className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        {language === 'zh' ? '上传本地图片' : 'Upload image'}
                    </button>
                    <div className="flex min-w-[220px] flex-1 items-center gap-2">
                        <input
                            value={imageUrlDraft}
                            onChange={e => setImageUrlDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleApplyImageUrl() }}
                            placeholder="https://example.com/wallpaper.jpg"
                            className="min-w-0 flex-1 rounded-lg border border-input-border bg-input px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
                        />
                        <button
                            onClick={handleApplyImageUrl}
                            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
                        >
                            <Link2 className="w-3.5 h-3.5" />
                            {language === 'zh' ? '应用' : 'Apply'}
                        </button>
                    </div>
                </div>

                {wallpaperError && (
                    <p className="mb-3 text-[11px] text-status-error">{wallpaperError}</p>
                )}

                {activeWallpaper && (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <div className="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
                                <span>{language === 'zh' ? '模糊' : 'Blur'}</span>
                                <span className="tabular-nums text-text-muted">{Math.round(activeWallpaper.blur)}px</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={24}
                                step={1}
                                value={activeWallpaper.blur}
                                onChange={e => handleWallpaperTuning({ blur: Number(e.target.value) })}
                                style={{ accentColor: 'rgb(var(--accent))' }}
                                className="w-full"
                            />
                        </label>

                        <label className="block">
                            <div className="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
                                <span>{language === 'zh' ? '遮罩' : 'Dim'}</span>
                                <span className="tabular-nums text-text-muted">{Math.round(activeWallpaper.dim * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={0.8}
                                step={0.02}
                                value={activeWallpaper.dim}
                                onChange={e => handleWallpaperTuning({ dim: Number(e.target.value) })}
                                style={{ accentColor: 'rgb(var(--accent))' }}
                                className="w-full"
                            />
                        </label>

                        <label className="block">
                            <div className="mb-1 flex items-center justify-between text-[11px] text-text-secondary">
                                <span>{language === 'zh' ? '面板不透明度' : 'Panel opacity'}</span>
                                <span className="tabular-nums text-text-muted">{Math.round(activeWallpaper.panelAlpha * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={activeWallpaper.panelAlpha}
                                onChange={e => handleWallpaperTuning({ panelAlpha: Number(e.target.value) })}
                                style={{ accentColor: 'rgb(var(--accent))' }}
                                className="w-full"
                            />
                        </label>

                        <div className="sm:col-span-2">
                            <div className="mb-1.5 text-[11px] text-text-secondary">
                                {language === 'zh' ? '铺放方式' : 'Fit'}
                            </div>
                            <div className="flex gap-2">
                                {([
                                    { value: 'cover' as WallpaperFit, zh: '铺满', en: 'Cover' },
                                    { value: 'contain' as WallpaperFit, zh: '完整显示', en: 'Contain' },
                                    { value: 'repeat' as WallpaperFit, zh: '平铺', en: 'Repeat' },
                                ]).map(opt => {
                                    const isFitActive = activeWallpaper.fit === opt.value
                                    return (
                                        <button
                                            key={opt.value}
                                            onClick={() => handleWallpaperTuning({ fit: opt.value })}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                                isFitActive
                                                    ? 'border-accent bg-accent/10 text-accent'
                                                    : 'border-border/60 text-text-secondary hover:border-accent/40'
                                            }`}
                                        >
                                            {language === 'zh' ? opt.zh : opt.en}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* 我的壁纸主题：把当前壁纸 + 滑块参数 + 明暗配色一起存下来，随时切回 */}
                <div className="mt-6 border-t border-border/60 pt-5">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h5 className="text-xs font-semibold text-text-primary">
                                {language === 'zh' ? '我的壁纸主题' : 'My wallpaper themes'}
                            </h5>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                                {language === 'zh'
                                    ? '保存当前壁纸与模糊、遮罩、面板不透明度，连同亮暗模式与配色。切换回来后一键还原。'
                                    : 'Save the current wallpaper with its blur, dim and opacity, plus the light/dark mode and color. Restore it in one click.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleStartSaveTheme}
                            disabled={!activeWallpaper}
                            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                activeWallpaper
                                    ? 'border-border/60 text-text-secondary hover:border-accent/40 hover:text-accent'
                                    : 'cursor-not-allowed border-border/30 text-text-muted/50'
                            }`}
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {language === 'zh' ? '保存为自定义主题' : 'Save as theme'}
                        </button>
                    </div>

                    {/* 新建主题：名称输入行 */}
                    {newThemeName !== null && (
                        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
                            <input
                                autoFocus
                                value={newThemeName}
                                maxLength={40}
                                onChange={e => setNewThemeName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleConfirmSaveTheme()
                                    if (e.key === 'Escape') setNewThemeName(null)
                                }}
                                placeholder={language === 'zh' ? '主题名称' : 'Theme name'}
                                className="min-w-[160px] flex-1 rounded-lg border border-input-border bg-input px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
                            />
                            <button
                                type="button"
                                onClick={handleConfirmSaveTheme}
                                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                            >
                                {language === 'zh' ? '保存' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setNewThemeName(null)}
                                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
                            >
                                {language === 'zh' ? '取消' : 'Cancel'}
                            </button>
                        </div>
                    )}

                    {customWallpaperThemes.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border/60 px-4 py-4 text-center text-[11px] text-text-muted">
                            {language === 'zh'
                                ? '还没有保存的主题。上传壁纸并调好参数后，点右上角「保存为自定义主题」。'
                                : 'No saved themes yet. Upload a wallpaper, tune the sliders, then click “Save as theme”.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                            {customWallpaperThemes.map(preset => {
                                const isActive = isSameWallpaperConfig(activeWallpaper, preset.wallpaper)
                                const thumb = resolveWallpaperImage(preset.wallpaper)
                                const builtin = preset.wallpaper.kind === 'builtin'
                                    ? getBuiltinWallpaper(preset.wallpaper.id)
                                    : undefined
                                const isEditing = editingTheme?.id === preset.id
                                const isDeleting = pendingDeleteId === preset.id

                                if (isDeleting) {
                                    return (
                                        <div
                                            key={preset.id}
                                            className="flex flex-col justify-center gap-2 rounded-lg border border-status-error/40 bg-status-error/5 px-3 py-3"
                                        >
                                            <p className="text-[11px] text-text-secondary">
                                                {language === 'zh' ? `删除「${preset.name}」？` : `Delete “${preset.name}”?`}
                                            </p>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteTheme(preset.id)}
                                                    className="flex-1 rounded-md bg-status-error px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                                                >
                                                    {language === 'zh' ? '删除' : 'Delete'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPendingDeleteId(null)}
                                                    className="flex-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/40"
                                                >
                                                    {language === 'zh' ? '取消' : 'Cancel'}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                }

                                return (
                                    <div
                                        key={preset.id}
                                        className={`group relative overflow-hidden rounded-lg border transition-all ${
                                            isActive
                                                ? 'border-accent ring-1 ring-accent/30'
                                                : 'border-border/50 hover:border-accent/40'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleApplyCustomTheme(preset)}
                                            className="block w-full text-left"
                                        >
                                            <div
                                                className="h-12 w-full"
                                                style={{
                                                    backgroundColor: builtin?.previewBg ?? '#0b1220',
                                                    backgroundImage: thumb || undefined,
                                                    backgroundSize: 'cover',
                                                    backgroundPosition: 'center',
                                                }}
                                            />
                                            <div className="flex items-center gap-1 px-2 py-1.5">
                                                <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                                                    {preset.name}
                                                </span>
                                                <span className="shrink-0 rounded bg-surface/70 px-1 text-[10px] text-text-muted">
                                                    {preset.themeMode === 'system'
                                                        ? (language === 'zh' ? '跟随' : 'Auto')
                                                        : preset.themeMode === 'dark'
                                                            ? (language === 'zh' ? '暗色' : 'Dark')
                                                            : (language === 'zh' ? '亮色' : 'Light')}
                                                </span>
                                            </div>
                                        </button>

                                        {isActive && !isEditing && (
                                            <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5">
                                                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                            </span>
                                        )}

                                        {/* 编辑 / 删除：默认隐藏，悬停或键盘聚焦时出现 */}
                                        {!isEditing && (
                                            <div className="absolute left-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                                <button
                                                    type="button"
                                                    title={language === 'zh' ? '编辑' : 'Edit'}
                                                    onClick={() => {
                                                        setPendingDeleteId(null)
                                                        setNewThemeName(null)
                                                        setEditingTheme({ id: preset.id, name: preset.name })
                                                    }}
                                                    className="rounded-md bg-black/45 p-1 text-white transition-colors hover:bg-black/65"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title={language === 'zh' ? '删除' : 'Delete'}
                                                    onClick={() => {
                                                        setEditingTheme(null)
                                                        setPendingDeleteId(preset.id)
                                                    }}
                                                    className="rounded-md bg-black/45 p-1 text-white transition-colors hover:bg-status-error"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}

                                        {/* 编辑态：改名 + 用当前设置覆盖 */}
                                        {isEditing && (
                                            <div className="space-y-2 border-t border-border/60 bg-surface/60 p-2">
                                                <input
                                                    autoFocus
                                                    value={editingTheme.name}
                                                    maxLength={40}
                                                    onChange={e => setEditingTheme({ id: preset.id, name: e.target.value })}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRenameTheme()
                                                        if (e.key === 'Escape') setEditingTheme(null)
                                                    }}
                                                    className="w-full rounded-md border border-input-border bg-input px-2 py-1 text-[11px] text-text-primary"
                                                />
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={handleRenameTheme}
                                                        className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                                                    >
                                                        {language === 'zh' ? '保存名称' : 'Rename'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!activeWallpaper}
                                                        onClick={() => handleOverwriteTheme(preset)}
                                                        className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                                                            activeWallpaper
                                                                ? 'border-border/60 text-text-secondary hover:border-accent/40 hover:text-accent'
                                                                : 'cursor-not-allowed border-border/30 text-text-muted/50'
                                                        }`}
                                                    >
                                                        {language === 'zh' ? '用当前设置覆盖' : 'Overwrite'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingTheme(null)}
                                                        className="rounded-md border border-border/60 p-1 text-text-secondary transition-colors hover:border-accent/40"
                                                        title={language === 'zh' ? '关闭' : 'Close'}
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
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

            {/* 编辑器设置 */}
            <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Code2 className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '编辑器设置' : 'Editor Settings'}
                    </h4>
                </div>

                <p className="text-sm text-text-muted mb-4">
                    {language === 'zh'
                        ? '配置代码编辑器的显示与行为选项。'
                        : 'Configure code editor display and behavior options.'}
                </p>

                <div className="flex flex-wrap gap-x-8 gap-y-4">
                    <ToggleSwitch
                        label={language === 'zh' ? '显示小地图' : 'Show minimap'}
                        checked={settings.minimap}
                        onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })}
                    />
                    <ToggleSwitch
                        label={language === 'zh' ? '自动换行' : 'Word wrap'}
                        checked={settings.wordWrap === 'on'}
                        onChange={(e) => setSettings({ ...settings, wordWrap: e.target.checked ? 'on' : 'off' })}
                    />
                    <ToggleSwitch
                        label={language === 'zh' ? '显示行号' : 'Show line numbers'}
                        checked={settings.lineNumbers === 'on'}
                        onChange={(e) => setSettings({ ...settings, lineNumbers: e.target.checked ? 'on' : 'off' })}
                    />
                    <ToggleSwitch
                        label={language === 'zh' ? '括号着色' : 'Bracket pair colorization'}
                        checked={settings.bracketPairColorization}
                        onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })}
                    />
                    <ToggleSwitch
                        label={language === 'zh' ? '保存时格式化' : 'Format on save'}
                        checked={settings.formatOnSave}
                        onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })}
                    />
                    <ToggleSwitch
                        label={language === 'zh' ? '打开编辑器/浏览器时收起侧栏' : 'Collapse panels on editor / browser'}
                        checked={settings.autoCollapseChromeOnFocus !== false}
                        onChange={(e) => setSettings({ ...settings, autoCollapseChromeOnFocus: e.target.checked })}
                    />
                </div>

                {/* Tab 大小选择 */}
                <div className="mt-5">
                    <label className={labelClass}>
                        {language === 'zh' ? '缩进大小' : 'Tab Size'}
                    </label>
                    <div className="flex gap-2">
                        {[2, 4, 8].map(size => (
                            <button
                                key={size}
                                onClick={() => setSettings({ ...settings, tabSize: size })}
                                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                                    settings.tabSize === size
                                        ? 'border-accent bg-accent/10 text-accent shadow-sm'
                                        : 'border-border/50 bg-surface/30 text-text-secondary hover:border-accent/30 hover:bg-surface/50'
                                }`}
                            >
                                {size}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 自动保存选择 */}
                <div className="mt-5">
                    <label className={labelClass}>
                        {language === 'zh' ? '自动保存' : 'Auto Save'}
                    </label>
                    <div className="flex gap-2">
                        {([
                            { value: 'off', labelZh: '关闭', labelEn: 'Off' },
                            { value: 'afterDelay', labelZh: '延迟保存', labelEn: 'After Delay' },
                            { value: 'onFocusChange', labelZh: '焦点切换时', labelEn: 'On Focus Change' },
                        ] as const).map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setSettings({ ...settings, autoSave: opt.value })}
                                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                                    settings.autoSave === opt.value
                                        ? 'border-accent bg-accent/10 text-accent shadow-sm'
                                        : 'border-border/50 bg-surface/30 text-text-secondary hover:border-accent/30 hover:bg-surface/50'
                                }`}
                            >
                                {language === 'zh' ? opt.labelZh : opt.labelEn}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* 悬浮头像设置 */}
            <section className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Circle className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '悬浮头像' : 'Floating Avatar'}
                    </h4>
                </div>

                <p className="text-sm text-text-muted mb-4">
                    {language === 'zh'
                        ? '配置屏幕上的悬浮头像，支持语音唤醒与迷你聊天。'
                        : 'Configure the floating avatar on screen, supporting voice wake word and mini chat.'}
                </p>

                <FloatingAvatarSettings />
            </section>
        </div>
    )
}
