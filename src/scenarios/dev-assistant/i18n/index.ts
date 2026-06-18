/**
 * 开发助手场景 - 独立 i18n 模块
 *
 * 通过 registerScenarioI18n / unregisterScenarioI18n 在场景激活/反激活时注入/移除翻译，
 * 避免场景特有 key 污染全局 i18n 文件。
 */
import { registerScenarioI18n, unregisterScenarioI18n } from '@renderer/i18n'
import { en } from './enUS'
import { zh } from './zhCN'

const SCENARIO_ID = 'dev-assistant'

export function registerDevAssistantI18n(): void {
  registerScenarioI18n(SCENARIO_ID, { en, zh })
}

export function unregisterDevAssistantI18n(): void {
  unregisterScenarioI18n(SCENARIO_ID)
}