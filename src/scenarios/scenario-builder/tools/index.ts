/**
 * 场景开发助手工具注册
 *
 * 将工具定义与执行器映射，返回 ScenarioToolDefinition 数组。
 */
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import type { ToolExecutor } from '@shared/protocols/modelGateway'
import { SCENARIO_BUILDER_TOOLS } from './definitions'
import {
  // 项目管理
  listScenarioProjectsExecutor,
  createScenarioProjectExecutor,
  getScenarioProjectExecutor,
  updateScenarioProjectExecutor,
  deleteScenarioProjectExecutor,
  // 开发辅助
  getScenarioTemplatesExecutor,
  readScenarioFileExecutor,
  writeScenarioFileExecutor,
  getScenarioKnowledgeExecutor,
  // 构建调试
  validateScenarioExecutor,
  buildScenarioExecutor,
  packScenarioExecutor,
  getBuildLogsExecutor,
  // 安装发布
  installScenarioExecutor,
  publishScenarioExecutor,
  getPublishHistoryExecutor,
  checkPublishStatusExecutor,
} from './executors'

/** 工具名称 → 执行器映射 */
const EXECUTOR_MAP: Record<string, ToolExecutor> = {
  list_scenario_projects: listScenarioProjectsExecutor,
  create_scenario_project: createScenarioProjectExecutor,
  get_scenario_project: getScenarioProjectExecutor,
  update_scenario_project: updateScenarioProjectExecutor,
  delete_scenario_project: deleteScenarioProjectExecutor,
  get_scenario_templates: getScenarioTemplatesExecutor,
  read_scenario_file: readScenarioFileExecutor,
  write_scenario_file: writeScenarioFileExecutor,
  get_scenario_knowledge: getScenarioKnowledgeExecutor,
  validate_scenario: validateScenarioExecutor,
  build_scenario: buildScenarioExecutor,
  pack_scenario: packScenarioExecutor,
  get_build_logs: getBuildLogsExecutor,
  install_scenario: installScenarioExecutor,
  publish_scenario: publishScenarioExecutor,
  get_publish_history: getPublishHistoryExecutor,
  check_publish_status: checkPublishStatusExecutor,
}

/**
 * 获取场景开发助手所有工具
 */
export function getScenarioBuilderTools(): ScenarioToolDefinition[] {
  return SCENARIO_BUILDER_TOOLS.map((def) => ({
    name: def.name,
    definition: def,
    executor: EXECUTOR_MAP[def.name] as ScenarioToolDefinition['executor'],
  }))
}
