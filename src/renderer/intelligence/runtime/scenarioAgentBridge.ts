/**
 * [AweeClaw] 场景-Agent 桥梁服务
 * 将场景系统的权限策略、工具包配置与 Agent 循环深度集成
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useStore } from '@store'

export interface ScenarioAgentConfig {
  scenarioId: string
  toolPacks: string[]
  modes: Array<{
    id: string
    label: string
    toolPolicy: { enabled: boolean; requireApproval?: boolean }
  }>
  contextTypes: Array<{ type: string; priority: number }>
  outputFormats: string[]
  securityPolicyActive: boolean
}

export interface ScenarioToolPermission {
  toolName: string
  allowed: boolean
  requireConfirmation: boolean
}

const scenarioConfigCache = new Map<string, ScenarioAgentConfig>()
const toolCallCounts = new Map<string, Map<string, number>>()

export function getScenarioAgentConfig(scenarioId: string): ScenarioAgentConfig {
  const cached = scenarioConfigCache.get(scenarioId)
  if (cached) return cached

  const scenario = scenarioRegistry.get(scenarioId)
  const capabilities = scenario?.capabilities
  const modes = capabilities?.modes || []

  const config: ScenarioAgentConfig = {
    scenarioId,
    toolPacks: capabilities?.toolPacks || [],
    modes: modes.map(m => ({
      id: m.id,
      label: m.label,
      toolPolicy: m.toolPolicy,
    })),
    contextTypes: (capabilities?.contextTypes || []).map(ct => ({
      type: ct.type,
      priority: ct.priority,
    })),
    outputFormats: capabilities?.outputFormats || [],
    securityPolicyActive: modes.some(m => m.toolPolicy?.enabled),
  }

  scenarioConfigCache.set(scenarioId, config)
  return config
}

export function checkScenarioToolPermission(
  scenarioId: string,
  toolName: string
): ScenarioToolPermission {
  const config = getScenarioAgentConfig(scenarioId)

  const modeWithPolicy = config.modes.find(m => m.toolPolicy?.enabled)
  if (!modeWithPolicy) {
    return { toolName, allowed: true, requireConfirmation: false }
  }

  const sensitiveTools = ['delete_file_or_folder', 'run_command', 'write_file', 'edit_file']
  const requireConfirmation = sensitiveTools.includes(toolName) || !!modeWithPolicy.toolPolicy?.requireApproval

  return { toolName, allowed: true, requireConfirmation }
}

export function recordToolCall(scenarioId: string, toolName: string): void {
  if (!toolCallCounts.has(scenarioId)) {
    toolCallCounts.set(scenarioId, new Map())
  }
  const counts = toolCallCounts.get(scenarioId)!
  counts.set(toolName, (counts.get(toolName) || 0) + 1)
}

export function getToolCallCount(scenarioId: string, toolName: string): number {
  return toolCallCounts.get(scenarioId)?.get(toolName) || 0
}

export function resetToolCallCounts(scenarioId: string): void {
  toolCallCounts.delete(scenarioId)
}

export function clearScenarioConfigCache(): void {
  scenarioConfigCache.clear()
}

export function getActiveScenarioConfig(): ScenarioAgentConfig | null {
  const activeScenarioId = useStore.getState().activeScenarioId
  if (!activeScenarioId) return null
  return getScenarioAgentConfig(activeScenarioId)
}

export function isScenarioSecurityActive(): boolean {
  const config = getActiveScenarioConfig()
  return config?.securityPolicyActive ?? false
}
