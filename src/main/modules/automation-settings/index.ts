/**
 * 本地自动化开关模块出口
 *
 * @module automation-settings
 */

export { automationSettings, AutomationSettingsStore } from './AutomationSettingsStore'

export {
  AUTOMATION_SETTINGS_LOG_PREFIX,
  AUTOMATION_SETTINGS_SCHEMA_VERSION,
  DEFAULT_AUTOMATION_SETTINGS,
  type AutomationSettings,
  type PersistedAutomationSettings,
} from './types'
