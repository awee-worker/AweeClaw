/**
 * 国际化模块
 * 支持中英文切换、命名空间扩展、React Hook
 */

import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { loadLocaleDict } from './locales'

export type Language = 'en' | 'zh'

/**
 * 语言文案的类型来源。
 *
 * 只取类型，不产生运行时引用 —— 若在这里静态导入语言包，
 * 打包时整份文案表都会被拉进引入本模块的任意 chunk，
 * 而拆分文案域的意义正是让它们按语言、按需加载。
 */
type EnType =
  & typeof import('./locales/enUS/app')['en']
  & typeof import('./locales/enUS/misc')['en']
type BaseTranslationKeys = keyof EnType

/** 已加载的语言字典（启动时由 initI18n 填充） */
const dictCache: Partial<Record<Language, Record<string, string>>> = {}

/** 语言初始化状态，供调用方判断是否可以安全渲染文案 */
let initPromise: Promise<void> | null = null
let initialized = false

/** 场景独立翻译注册表，key 为场景 ID */
const scenarioI18nRegistry = new Map<string, { en: Record<string, string>; zh: Record<string, string> }>()

let extraEn: Record<string, string> = {}
let extraZh: Record<string, string> = {}

/** 重建 extraEn/extraZh 合并所有已注册场景翻译 */
function rebuildExtraTranslations() {
  extraEn = {}
  extraZh = {}
  for (const translations of scenarioI18nRegistry.values()) {
    extraEn = { ...extraEn, ...translations.en }
    extraZh = { ...extraZh, ...translations.zh }
  }
  // 合并结果按语言缓存，场景翻译变动后必须失效，否则新注册的文案取不到
  mergedCache.zh = undefined
  mergedCache.en = undefined
}

/**
 * 注册场景独立翻译
 * @param scenarioId 场景唯一 ID，如 'dev-assistant'
 * @param translations 场景的 { en, zh } 翻译对象
 */
export function registerScenarioI18n(scenarioId: string, translations: { en: Record<string, string>; zh: Record<string, string> }) {
  scenarioI18nRegistry.set(scenarioId, translations)
  rebuildExtraTranslations()
}

/**
 * 反注册场景翻译（场景卸载时调用）
 * @param scenarioId 场景唯一 ID
 */
export function unregisterScenarioI18n(scenarioId: string) {
  scenarioI18nRegistry.delete(scenarioId)
  rebuildExtraTranslations()
}

/** @deprecated 使用 registerScenarioI18n 替代 */
export function registerTranslations(translations: { en: Record<string, string>; zh: Record<string, string> }) {
  extraEn = { ...extraEn, ...translations.en }
  extraZh = { ...extraZh, ...translations.zh }
  mergedCache.zh = undefined
  mergedCache.en = undefined
}

/**
 * 初始化文案。
 *
 * 文案域按语言分包，加载是异步的，因此这一步必须在首次渲染之前完成 ——
 * 否则组件拿到的会是原始 key。重复调用共享同一次加载，
 * 已初始化的语言直接返回，不会重复请求。
 *
 * @param lang 首选语言；英文始终一并加载，作为缺失 key 的兜底
 */
export function initI18n(lang: Language): Promise<void> {
  if (initialized) return Promise.resolve()
  if (initPromise) return initPromise

  initPromise = (async () => {
    // 兜底语言与首选语言并行取：t() 在首选语言缺 key 时要退回英文，
    // 分两次串行加载会让兜底在首帧尚未就绪
    const [primary] = await Promise.all([
      loadLocaleDict(lang),
      lang === 'en' ? Promise.resolve() : loadLocaleDict('en'),
    ])
    dictCache[lang] = primary
    initialized = true
  })().catch((err) => {
    // 失败后允许重试：下一次调用重新走一遍加载
    initPromise = null
    throw err
  })

  return initPromise
}

/** 文案是否已就绪（供启动流程与测试判断） */
export function isI18nReady(): boolean {
  return initialized
}

/** 该语言的字典是否已就绪 */
export function isLanguageLoaded(lang: Language): boolean {
  return dictCache[lang] !== undefined
}

/** 切换语言时载入新语言（未加载过的语言按需取） */
export async function ensureLanguageLoaded(lang: Language): Promise<void> {
  if (dictCache[lang]) return
  const [dict] = await Promise.all([
    loadLocaleDict(lang),
    lang === 'en' ? Promise.resolve() : ensureLanguageLoaded('en'),
  ])
  dictCache[lang] = dict
  mergedCache[lang] = undefined
}

/**
 * 取某语言的完整字典。
 *
 * 场景注册的翻译在读取时叠加。合并结果按语言缓存，
 * 只在场景翻译变更时失效 —— 原实现每次调用都展开整份文案表（5000+ 键），
 * 而 t() 在渲染期间会被高频调用，这份开销没有必要。
 */
const mergedCache: Partial<Record<Language, Record<string, string>>> = {}

export function getTranslations(lang: Language): Record<string, string> {
  const cached = mergedCache[lang]
  if (cached) return cached

  const base = dictCache[lang] ?? {}
  const extra = lang === 'zh' ? extraZh : extraEn
  const merged = Object.keys(extra).length > 0 ? { ...base, ...extra } : base
  mergedCache[lang] = merged
  return merged
}

/**
 * 是否为开发态。
 *
 * 惰性求值：首次使用时读一次 import.meta.env，之后走缓存，
 * 避免每个 t() 调用都去触碰构建期注入的对象。
 */
let devFlag: boolean | undefined

function isDevBuild(): boolean {
  if (devFlag === undefined) {
    try {
      devFlag = Boolean((import.meta as any)?.env?.DEV)
    } catch {
      devFlag = false
    }
  }
  return devFlag
}

/** 已告警过的 key，避免同一处文案在每次渲染时刷屏 */
const warnedResidualKeys = new Set<string>()

/**
 * 开发期兜底：替换完成后若仍残留 {xxx}，说明模板与调用处的参数名对不上。
 *
 * t() 只做字面替换，不解析表达式，所以模板里若写了三元、属性访问之类的
 * JS 代码，占位符永远替换不掉，用户看到的就是原样花括号。
 * 这类问题在开发阶段就该暴露，而不是等上线后从界面上发现。
 *
 * 两类合法字面量需要放行，不能误报：
 * - {{model}}：载荷级占位符，故意留给下游替换
 * - ${1:placeholder}：代码片段示例里的模板字面量
 */
function assertNoResidualPlaceholder(key: string, text: string): void {
  if (warnedResidualKeys.has(key)) return

  const scrubbed = text
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\$\{[^{}]*\}/g, '')

  const residue = scrubbed.match(/\{[^{}]+\}/)
  if (!residue) return

  warnedResidualKeys.add(key)
  console.warn(
    `[i18n] 文案 "${key}" 残留未替换的占位符 ${residue[0]}。` +
    `模板只能用 {name} 形式的参数名，不能写表达式；` +
    `请核对该模板与调用处传入的参数名是否一致。`,
  )
}

export function t(key: string, lang: Language, params?: Record<string, string | number | undefined>): string {
  const dict = getTranslations(lang)
  let text: string = dict[key]
  if (text === undefined && lang !== 'en') {
    text = getTranslations('en')[key]
  }
  if (text === undefined) {
    // 文案未初始化或该 key 确实不存在：返回 key 本身，便于定位缺失项
    return key
  }
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v))
    })
  }
  if (isDevBuild()) {
    assertNoResidualPlaceholder(key, text)
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
  const [, bump] = useState(0)

  // 语言包按需加载：运行中切到未加载过的语言时，这里补齐并触发一次重渲染，
  // 避免界面停留在原始 key 上
  useEffect(() => {
    if (isLanguageLoaded(language)) return
    let cancelled = false
    void ensureLanguageLoaded(language).then(() => {
      if (!cancelled) bump((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [language])

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
