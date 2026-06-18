/**
 * dev-studio 工具导出
 */
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import { DEV_STUDIO_TOOLS } from './definitions'
import {
  scaffoldProjectExecutor,
  listTemplatesExecutor,
  getProjectInfoExecutor,
} from './executors'

export function getDevStudioTools(): ScenarioToolDefinition[] {
  const executorMap: Record<string, any> = {
    scaffold_project: scaffoldProjectExecutor,
    list_templates: listTemplatesExecutor,
    get_project_info: getProjectInfoExecutor,
  }

  return DEV_STUDIO_TOOLS.map(tool => ({
    name: tool.name,
    definition: tool,
    executor: executorMap[tool.name] ?? (async () => ({ success: false, error: `Executor not implemented: ${tool.name}` })),
    version: '1.0.0',
  }))
}

export { DEV_STUDIO_TOOLS, DEV_AGENT_ROLES } from './definitions'