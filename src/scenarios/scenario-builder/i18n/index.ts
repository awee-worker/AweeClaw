/**
 * scenario-builder 场景 - 独立 i18n 模块
 */
import { registerScenarioI18n, unregisterScenarioI18n } from '@renderer/i18n'
import { en } from './enUS'
import { zh } from './zhCN'

const SCENARIO_ID = 'scenario-builder'

export function registerScenarioBuilderI18n(): void {
  registerScenarioI18n(SCENARIO_ID, { en, zh })
}

export function unregisterScenarioBuilderI18n(): void {
  unregisterScenarioI18n(SCENARIO_ID)
}
