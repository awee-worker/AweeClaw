/**
 * dev-studio 场景 - 独立 i18n 模块
 */
import { registerScenarioI18n, unregisterScenarioI18n } from '@renderer/i18n'
import { en } from './enUS'
import { zh } from './zhCN'

const SCENARIO_ID = 'dev-studio'

export function registerDevStudioI18n(): void {
  registerScenarioI18n(SCENARIO_ID, { en, zh })
}

export function unregisterDevStudioI18n(): void {
  unregisterScenarioI18n(SCENARIO_ID)
}