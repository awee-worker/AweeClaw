/**
 * 国际化模块
 * 支持中英文切换、命名空间扩展、React Hook
 */

import { useCallback } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { en } from './locales/enUS'
import { zh } from './locales/zhCN'

export type Language = 'en' | 'zh'

type EnType = typeof en
type BaseTranslationKeys = keyof EnType

let extraEn: Record<string, string> = {}
let extraZh: Record<string, string> = {}

export function registerTranslations(translations: { en: Record<string, string>; zh: Record<string, string> }) {
  extraEn = { ...extraEn, ...translations.en }
  extraZh = { ...extraZh, ...translations.zh }
}

export function getTranslations(lang: Language): Record<string, string> {
  const base = lang === 'zh' ? zh : en
  return { ...base, ...(lang === 'zh' ? extraZh : extraEn) }
}

export function t(key: string, lang: Language, params?: Record<string, string | number | undefined>): string {
  const dict = getTranslations(lang)
  let text: string = dict[key] || getTranslations('en')[key] || key
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v))
    })
  }
  return text
}

export function createTranslator(lang: Language) {
  return (key: string, params?: Record<string, string | number>) => t(key, lang, params)
}

export function getSupportedLanguages(): Array<{ code: Language; name: string }> {
  return [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
  ]
}

export function detectBrowserLanguage(): Language {
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}

export function useI18n() {
  const language = useStore(useShallow(s => s.language)) as Language
  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => t(key, language, params),
    [language],
  )
  return { t: translate, language }
}

export function localize<T extends Record<string, unknown>>(obj: T, lang: Language): string {
  if (lang === 'zh') {
    return (obj.nameZh || obj.labelZh || obj.titleZh || obj.descriptionZh || obj.zh || obj.name || obj.label || obj.title || obj.description || obj.en || '') as string
  }
  return (obj.name || obj.label || obj.title || obj.description || obj.en || obj.nameEn || obj.labelEn || obj.titleEn || '') as string
}

export type { BaseTranslationKeys as TranslationKey }
