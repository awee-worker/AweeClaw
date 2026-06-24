import { t } from '@renderer/i18n'
import { useStore } from '@store'

export type AgentLanguage = 'en' | 'zh'

export function resolveAgentLanguage(): AgentLanguage {
  return useStore.getState().language as AgentLanguage
}

export function translateAgentText(
  key: Parameters<typeof t>[0],
  params?: Record<string, string | number>,
  language: AgentLanguage = resolveAgentLanguage()
): string {
  return t(key, language, params)
}

export function pickLocalizedText(
  zh: string,
  en: string,
  language: AgentLanguage = resolveAgentLanguage()
): string {
  return language === 'zh' ? zh : en
}

/** @deprecated 请使用 resolveAgentLanguage */
export const getAgentLanguage = resolveAgentLanguage
