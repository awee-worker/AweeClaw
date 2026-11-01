/**
 * 快速设置子菜单组件
 *
 * 在用户菜单中提供界面语言与界面主题的快速切换。
 * - 界面语言：中文 / English
 * - 界面主题：亮色 / 暗色 / 跟随系统、4 种配色、内置壁纸与用户保存的自定义壁纸主题，
 *   末尾通向完整的外观设置
 *
 * 交互：鼠标 hover 父项时向右展开二级菜单，点击选项立即生效。
 * 实现：父项与二级菜单放在同一个 div 内，统一管理 hover，避免移动断开。
 */

import { useState, useCallback, useEffect } from 'react'
import { Globe, Sun, Moon, Monitor, Check, ChevronRight, ChevronLeft, Palette } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager } from '@/renderer/config/themeDefinition'
import {
  BUILTIN_WALLPAPERS,
  DEFAULT_WALLPAPER_TUNING,
  getBuiltinWallpaper,
  isSameWallpaperConfig,
  resolveWallpaperImage,
  type CustomWallpaperTheme,
} from '@/renderer/config/wallpaper'
import { api } from '@renderer/adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import type { ThemeMode, ThemeColor } from '@store'

/**
 * 二级菜单展开方向
 *
 * rail：一级菜单挂在导航栏左下角，左侧是屏幕外，因此向右展开；
 * left：一级菜单来自顶部右上角的账号按钮，右侧已到窗口边缘，必须向左展开，
 *       否则二级菜单整块溢出到可视区之外。
 */
export type QuickSettingsDirection = 'right' | 'left'

interface QuickSettingsMenuProps {
  language: Language
  onClose: () => void
  direction?: QuickSettingsDirection
  /**
   * 打开「设置 → 外观」。
   *
   * 二级菜单只放得下最常用的几项，模糊、遮罩、自定义图片这些还得进设置页调；
   * 由调用方传入而不是在这里直接改 store，是为了复用宿主那套「先收起侧边栏与
   * 抽屉再打开全屏页」的逻辑，否则设置页会被侧栏压在下面。
   */
  onOpenAppearanceSettings?: () => void
}

/**
 * 二级菜单容器样式：按方向贴在一级菜单的左/右边缘
 *
 * 底色用 bg-popover（固定 96%）而不是 bg-surface/95：后者会乘 --panel-alpha，
 * 壁纸模式下只剩一成多不透明度，菜单直接和后面的页面糊在一起，字都看不清。
 */
function subMenuClass(direction: QuickSettingsDirection, width = 'w-44'): string {
  const anchor =
    direction === 'left'
      ? 'right-full mr-1 top-0'
      : 'left-full ml-1 top-0'
  return `absolute ${anchor} ${width} py-1 rounded-xl bg-popover backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-[10000]`
}

/**
 * 应用主题模式 + 配色并落盘。
 *
 * 主题模式切换和壁纸明暗联动都走这一份：两处各拼一遍，迟早会出现
 * 「换了壁纸但主题没跟着切」或者反过来的错位状态。
 */
function applyThemeSelection(mode: ThemeMode, color: ThemeColor): void {
  const state = useStore.getState()
  state.setThemeMode(mode)
  state.setThemeColor(color)
  const resolved = themeManager.resolveThemeByModeAndColor(mode, color)
  state.setTheme(resolved.id)
  themeManager.setTheme(resolved.id)
  api.settings.set('themeId', resolved.id)
}

/**
 * 当前生效壁纸命中的自定义主题 id。
 *
 * 壁纸由 themeManager 直接写 DOM，不经过 React 状态，菜单拿不到变更通知，
 * 只能拿生效壁纸与存档逐条比对；用户事后又拖过滑块就比对不上，视为未选中。
 */
function findMatchingThemeId(themes: CustomWallpaperTheme[]): string {
  const current = themeManager.getUserWallpaper()
  if (!current) return ''
  return themes.find(item => isSameWallpaperConfig(item.wallpaper, current))?.id ?? ''
}

/** 二级菜单指示箭头：方向与展开方向一致 */
function SubMenuArrow({ direction }: { direction: QuickSettingsDirection }) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight
  return <Icon className="w-3 h-3 text-text-muted" />
}

/** 父项触发器样式 */
const TRIGGER_CLASS =
  'w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px] cursor-pointer'

/** 二级菜单选项样式 */
const ITEM_CLASS =
  'w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]'

/** 分组标题样式 */
const GROUP_TITLE_CLASS =
  'px-3 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider'

/** 界面语言快速切换 */
function LanguageSubMenu({ language, onClose, direction = 'right' }: QuickSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = useCallback(async (lang: Language) => {
    try {
      useStore.getState().set('language', lang)
      await api.settings.set('language', lang)
      window.electronAPI?.setLanguage?.(lang)
    } catch (e) {
      console.error('[LanguageSubMenu] Failed to set language:', e)
    }
    onClose()
  }, [onClose])

  const options: { value: Language; label: string; flag: string }[] = [
    { value: 'zh', label: '中文', flag: '🇨🇳' },
    { value: 'en', label: 'English', flag: '🇺🇸' },
  ]

  return (
    <div
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      className="relative"
    >
      <div className={TRIGGER_CLASS}>
        <Globe className="w-[16px] h-[16px]" strokeWidth={1.5} />
        <span className="flex-1 text-left">{t('layout.interfacelanguage', language)}</span>
        <SubMenuArrow direction={direction} />
      </div>
      {isOpen && (
        <div className={subMenuClass(direction)}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={ITEM_CLASS}
            >
              <span className="text-base">{opt.flag}</span>
              <span className="flex-1 text-left">{opt.label}</span>
              {language === opt.value && (
                <Check className="w-3.5 h-3.5 text-accent" strokeWidth={2.5} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 界面主题快速切换：明暗模式、配色、壁纸，以及进入完整设置页的入口 */
function ThemeSubMenu({
  language,
  onClose,
  direction = 'right',
  onOpenAppearanceSettings,
}: QuickSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  // 壁纸经 themeManager 直接写 DOM，不会触发 React 重渲染，选中态因此由本地状态承担
  const [activeWallpaperId, setActiveWallpaperId] = useState(() => {
    const active = themeManager.getActiveWallpaper()
    return active?.kind === 'builtin' ? active.id : ''
  })
  // 自定义壁纸主题：列表与当前命中的主题 id 同样不走 React 通知，展开时重新同步
  const [customThemes, setCustomThemes] = useState<CustomWallpaperTheme[]>(
    () => themeManager.getCustomWallpaperThemes()
  )
  const [activeCustomThemeId, setActiveCustomThemeId] = useState<string>(() =>
    findMatchingThemeId(themeManager.getCustomWallpaperThemes())
  )

  /**
   * 每次展开都重新读一遍。
   *
   * 自定义主题可能刚在设置页被保存或删除，壁纸也可能在那里换过，
   * 只在挂载时算一次会留下一排过期的高亮。
   */
  useEffect(() => {
    if (!isOpen) return
    const themes = themeManager.getCustomWallpaperThemes()
    setCustomThemes(themes)
    setActiveCustomThemeId(findMatchingThemeId(themes))
    const active = themeManager.getActiveWallpaper()
    setActiveWallpaperId(active?.kind === 'builtin' ? active.id : '')
  }, [isOpen])

  const { themeMode, themeColor } = useStore(useShallow(s => ({
    themeMode: s.themeMode,
    themeColor: s.themeColor,
  })))

  const handleModeSelect = useCallback((mode: ThemeMode) => {
    applyThemeSelection(mode, themeColor)
    onClose()
  }, [themeColor, onClose])

  const handleColorSelect = useCallback((color: ThemeColor) => {
    applyThemeSelection(themeMode, color)
    onClose()
  }, [themeMode, onClose])

  /**
   * 切换壁纸
   *
   * 与模式、配色不同，这里不关闭菜单：八套壁纸是并列备选，用户通常要来回比两三次
   * 才定得下来，每点一次就收掉菜单再重新展开，等于不给预览的机会。
   */
  const handleWallpaperSelect = useCallback((id: string) => {
    const builtin = getBuiltinWallpaper(id)
    if (!builtin) return

    // 壁纸就是页面底色，正文配色必须与它同明暗：亮色壁纸配暗色主题会浅底浅字
    if (builtin.themeType !== themeManager.getCurrentTheme().type) {
      applyThemeSelection(builtin.themeType, themeColor)
    }

    // 沿用当前调参：换壁纸不该把模糊、遮罩、面板不透明度一并重置回默认值
    const base = themeManager.getActiveWallpaper() ?? DEFAULT_WALLPAPER_TUNING
    themeManager.setUserWallpaper({
      id,
      kind: 'builtin',
      blur: base.blur,
      dim: base.dim,
      panelAlpha: base.panelAlpha,
      fit: base.fit,
    })
    setActiveWallpaperId(id)
    setActiveCustomThemeId('')
  }, [themeColor])

  /** 恢复为主题自带壁纸 */
  const handleFollowTheme = useCallback(() => {
    themeManager.setUserWallpaper(null)
    setActiveWallpaperId('')
    setActiveCustomThemeId('')
  }, [])

  /**
   * 应用一套自定义壁纸主题
   *
   * 与设置页的「一键还原」保持同一套动作：明暗模式、配色、壁纸与四个滑块参数
   * 一起恢复。只换图不换配色会出现浅底浅字，所以配色必须跟着回来。
   * 同样不关闭菜单 —— 存下来的几套主题常要来回比。
   */
  const handleCustomThemeSelect = useCallback((preset: CustomWallpaperTheme) => {
    const color = themeManager.getColorThemeById(preset.colorThemeId)?.color
      ?? themeManager.resolveColorFromThemeId(preset.colorThemeId)
    applyThemeSelection(preset.themeMode, color)
    themeManager.setUserWallpaper(preset.wallpaper)
    setActiveWallpaperId(preset.wallpaper.kind === 'builtin' ? preset.wallpaper.id : '')
    setActiveCustomThemeId(preset.id)
  }, [])

  const modeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('layout.lighttheme', language), icon: Sun },
    { value: 'dark', label: t('layout.darktheme', language), icon: Moon },
    { value: 'system', label: t('layout.systemtheme', language), icon: Monitor },
  ]

  const colorOptions: { value: ThemeColor; label: string }[] = [
    { value: 'blue', label: t('layout.colorblue', language) },
    { value: 'purple', label: t('layout.colorpurple', language) },
    { value: 'red', label: t('layout.colorred', language) },
    { value: 'green', label: t('layout.colorgreen', language) },
  ]

  // 解析 system 模式下的实际生效类型
  const effectiveMode: 'light' | 'dark' =
    themeMode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : themeMode

  return (
    <div
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      className="relative"
    >
      <div className={TRIGGER_CLASS}>
        <Sun className="w-[16px] h-[16px]" strokeWidth={1.5} />
        <span className="flex-1 text-left">{t('layout.interfacetheme', language)}</span>
        <SubMenuArrow direction={direction} />
      </div>
      {isOpen && (
        <div className={subMenuClass(direction, 'w-60')}>
          {/* 主题模式 */}
          <div className={GROUP_TITLE_CLASS}>
            {t('layout.thememode', language)}
          </div>
          {modeOptions.map(opt => {
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                onClick={() => handleModeSelect(opt.value)}
                className={ITEM_CLASS}
              >
                <Icon className="w-[14px] h-[14px]" strokeWidth={1.5} />
                <span className="flex-1 text-left">{opt.label}</span>
                {themeMode === opt.value && (
                  <Check className="w-3.5 h-3.5 text-accent" strokeWidth={2.5} />
                )}
              </button>
            )
          })}

          <div className="h-px bg-border/50 my-1 mx-2" />

          {/* 主题颜色 */}
          <div className={GROUP_TITLE_CLASS}>
            {t('layout.themecolor', language)}
          </div>
          <div className="px-3 py-1.5 flex items-center gap-2">
            {colorOptions.map(opt => {
              const theme = themeManager.resolveThemeByModeAndColor(effectiveMode, opt.value)
              const isActive = themeColor === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => handleColorSelect(opt.value)}
                  title={opt.label}
                  className={`relative w-6 h-6 rounded-full transition-all duration-200 ${
                    isActive ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface scale-110' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: `rgb(${theme.colors.accent})` }}
                >
                  {isActive && (
                    <Check className="absolute inset-0 m-auto w-3 h-3 text-white" strokeWidth={3} />
                  )}
                </button>
              )
            })}
          </div>

          <div className="h-px bg-border/50 my-1 mx-2" />

          {/* 界面壁纸：换配色和换壁纸是同一件事的两面，放在主题里最顺手 */}
          <div className={GROUP_TITLE_CLASS}>
            {language === 'zh' ? '界面壁纸' : 'Wallpaper'}
          </div>
          <button onClick={handleFollowTheme} className={ITEM_CLASS}>
            <span className="flex-1 text-left">
              {language === 'zh' ? '跟随主题' : 'Follow theme'}
            </span>
            {!activeWallpaperId && !activeCustomThemeId && (
              <Check className="w-3.5 h-3.5 text-accent" strokeWidth={2.5} />
            )}
          </button>
          <div className="grid grid-cols-4 gap-1.5 px-2 py-1">
            {BUILTIN_WALLPAPERS.map(wp => {
              // 自定义主题自带壁纸，选中它时这张图不再单独算「当前壁纸」，
              // 否则同一张图会在两处同时打勾，看不出到底选了哪一项
              const isActive = wp.id === activeWallpaperId && !activeCustomThemeId
              return (
                <button
                  key={wp.id}
                  onClick={() => handleWallpaperSelect(wp.id)}
                  title={language === 'zh' ? wp.nameZh : wp.nameEn}
                  aria-label={language === 'zh' ? wp.nameZh : wp.nameEn}
                  className={`relative h-9 overflow-hidden rounded-md border transition-all ${
                    isActive
                      ? 'border-accent ring-1 ring-accent/40'
                      : 'border-border/50 hover:border-accent/40'
                  }`}
                  style={{
                    backgroundColor: wp.previewBg,
                    backgroundImage: wp.css,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {isActive && (
                    <Check
                      className="absolute right-0.5 top-0.5 w-2.5 h-2.5 text-white drop-shadow"
                      strokeWidth={3}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* 我的壁纸主题：内置壁纸之下直接列出来，省得为了切一套存好的
              主题再进一次设置页。列表过长时自己滚动，不把菜单撑出屏幕 */}
          {customThemes.length > 0 && (
            <>
              <div className="h-px bg-border/50 my-1 mx-2" />
              <div className={GROUP_TITLE_CLASS}>
                {language === 'zh' ? '我的壁纸主题' : 'My wallpaper themes'}
              </div>
              <div className="max-h-44 overflow-y-auto">
                {customThemes.map(preset => {
                  const isActive = preset.id === activeCustomThemeId
                  const builtin =
                    preset.wallpaper.kind === 'builtin'
                      ? getBuiltinWallpaper(preset.wallpaper.id)
                      : undefined
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleCustomThemeSelect(preset)}
                      title={preset.name}
                      className={ITEM_CLASS}
                    >
                      <span
                        className="w-7 h-4 flex-shrink-0 rounded border border-border/50 overflow-hidden"
                        style={{
                          backgroundColor: builtin?.previewBg,
                          backgroundImage: resolveWallpaperImage(preset.wallpaper) ?? undefined,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                      />
                      <span className="flex-1 min-w-0 text-left truncate">{preset.name}</span>
                      {isActive && (
                        <Check className="w-3.5 h-3.5 text-accent" strokeWidth={2.5} />
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="h-px bg-border/50 my-1 mx-2" />

          {/* 完整设置的入口：模糊、遮罩、自定义图片这些参数塞不进二级菜单 */}
          <button onClick={onOpenAppearanceSettings} className={ITEM_CLASS}>
            <Palette className="w-[14px] h-[14px]" strokeWidth={1.5} />
            <span className="flex-1 text-left">
              {language === 'zh' ? '自定义主题' : 'Customize theme'}
            </span>
            <ChevronRight className="w-3 h-3 text-text-muted" />
          </button>
        </div>
      )}
    </div>
  )
}

export function QuickSettingsMenu({
  language,
  onClose,
  direction = 'right',
  onOpenAppearanceSettings,
}: QuickSettingsMenuProps) {
  return (
    <>
      <LanguageSubMenu language={language} onClose={onClose} direction={direction} />
      <ThemeSubMenu
        language={language}
        onClose={onClose}
        direction={direction}
        onOpenAppearanceSettings={onOpenAppearanceSettings}
      />
    </>
  )
}
