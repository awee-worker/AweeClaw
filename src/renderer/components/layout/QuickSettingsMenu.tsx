/**
 * 快速设置子菜单组件
 *
 * 在用户菜单中提供界面语言和界面主题的快速切换。
 * - 界面语言：中文 / English
 * - 界面主题：亮色 / 暗色 / 跟随系统 + 4 种颜色
 *
 * 交互：鼠标 hover 父项时向右展开二级菜单，点击选项立即生效。
 * 实现：父项与二级菜单放在同一个 div 内，统一管理 hover，避免移动断开。
 */

import { useState, useCallback } from 'react'
import { Globe, Sun, Moon, Monitor, Check, ChevronRight } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager } from '@/renderer/config/themeDefinition'
import { api } from '@renderer/adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import type { ThemeMode, ThemeColor } from '@store'

interface QuickSettingsMenuProps {
  language: Language
  onClose: () => void
}

/** 二级菜单容器样式（向右展开） */
const SUB_MENU_CLASS =
  'absolute left-full top-0 w-44 py-1 rounded-xl bg-surface/95 backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-[10000]'

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
function LanguageSubMenu({ language, onClose }: QuickSettingsMenuProps) {
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
        <ChevronRight className="w-3 h-3 text-text-muted" />
      </div>
      {isOpen && (
        <div className={SUB_MENU_CLASS}>
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

/** 界面主题快速切换 */
function ThemeSubMenu({ language, onClose }: QuickSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const { themeMode, themeColor, setThemeMode, setThemeColor } = useStore(useShallow(s => ({
    themeMode: s.themeMode,
    themeColor: s.themeColor,
    setThemeMode: s.setThemeMode,
    setThemeColor: s.setThemeColor,
  })))

  const applyThemeForModeAndColor = useCallback((mode: ThemeMode, color: ThemeColor) => {
    const resolvedTheme = themeManager.resolveThemeByModeAndColor(mode, color)
    useStore.getState().setTheme(resolvedTheme.id)
    themeManager.setTheme(resolvedTheme.id)
    api.settings.set('themeId', resolvedTheme.id)
  }, [])

  const handleModeSelect = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    applyThemeForModeAndColor(mode, themeColor)
    onClose()
  }, [setThemeMode, applyThemeForModeAndColor, themeColor, onClose])

  const handleColorSelect = useCallback((color: ThemeColor) => {
    setThemeColor(color)
    applyThemeForModeAndColor(themeMode, color)
    onClose()
  }, [setThemeColor, applyThemeForModeAndColor, themeMode, onClose])

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
        <ChevronRight className="w-3 h-3 text-text-muted" />
      </div>
      {isOpen && (
        <div className={SUB_MENU_CLASS}>
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
        </div>
      )}
    </div>
  )
}

export function QuickSettingsMenu({ language, onClose }: QuickSettingsMenuProps) {
  return (
    <>
      <LanguageSubMenu language={language} onClose={onClose} />
      <ThemeSubMenu language={language} onClose={onClose} />
    </>
  )
}
