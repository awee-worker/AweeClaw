/**
 * 场景注册表初始化（桥接层）
 *
 * 将新架构场景模块中的 ScenarioPlugin 注册到旧版 ScenarioRegistry，
 * 确保现有 UI 组件（ScenarioSelector、ActivityBar 等）继续正常工作。
 *
 * 新架构场景模块是场景配置的唯一来源（Single Source of Truth），
 * 旧版配置文件（codeEditorScenario.ts 等）不再使用。
 */

import { scenarioRegistry } from '../../types/scenario'
import { generalAssistantScenario } from '@/scenarios/general-assistant/config/scenario'
import { codeEditorScenario } from '@/scenarios/code-editor/config/scenario'
import { dataAnalystScenario } from '@/scenarios/data-analyst/config/scenario'
import { creativeWriterScenario } from '@/scenarios/creative-writer/config/scenario'
import { lowVoltageScenario } from '@/scenarios/low-voltage/config/scenario'

let initialized = false

export function initializeScenarios(activeScenarioId?: string): void {
  if (initialized) return

  scenarioRegistry.register(generalAssistantScenario)
  scenarioRegistry.register(codeEditorScenario)
  scenarioRegistry.register(dataAnalystScenario)
  scenarioRegistry.register(creativeWriterScenario)
  scenarioRegistry.register(lowVoltageScenario)

  scenarioRegistry.loadCustomScenarios()

  if (activeScenarioId) {
    scenarioRegistry.setActive(activeScenarioId)
  }

  initialized = true
}

export { scenarioRegistry }
