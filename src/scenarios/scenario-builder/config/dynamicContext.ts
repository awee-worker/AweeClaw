/**
 * 场景开发助手 - 动态上下文提供器
 *
 * 在系统提示词构建时调用，将"当前选中项目"的关键信息注入到 AI 上下文，
 * 让 AI 直接知道：
 * - 当前用户在 UI 上选中了哪个项目（id/name）
 * - 项目目录位置（localPath）—— AI 可直接 read_scenario_file / write_scenario_file
 * - 项目类型（declarative 声明式 / programmatic 编程式）—— AI 据此决定生成 scenario.json 还是 .ts 入口
 * - 项目版本、状态、scenarioId
 *
 * 这样 AI 无需先调用 list_scenario_projects 即可开展后续工作。
 */
import type { ScenarioProject } from '../types'
import { selectedProjectStore } from '../hooks/useSelectedProject'

/**
 * 将单个项目格式化为系统提示词片段。
 * 抽出为独立函数便于单测。
 */
export function formatProjectContext(project: ScenarioProject): string {
  const typeLabel = project.type === 'declarative' ? 'declarative（声明式：通过 scenario.json 配置）' : 'programmatic（编程式：通过 TypeScript 入口文件）'
  const tags = project.tags?.length ? project.tags.join(', ') : '-'
  const lastBuilt = project.lastBuiltAt || '-'
  const lastPublished = project.lastPublishedAt || '-'

  return `## Current Scenario Project

用户当前在场景开发助手 UI 中选中的项目（所有场景开发工具默认对此项目生效）：

- **Project ID**: \`${project.id}\`
- **Name**: ${project.name}
- **Scenario ID**: \`${project.scenarioId}\`
- **Type**: ${typeLabel}
- **Version**: ${project.version}
- **Status**: ${project.status}
- **Author**: ${project.author || '-'}
- **Tags**: ${tags}
- **Local Path**: \`${project.localPath}\`
- **Created At**: ${project.createdAt}
- **Updated At**: ${project.updatedAt}
- **Last Built At**: ${lastBuilt}
- **Last Published At**: ${lastPublished}

### 使用提示
1. 调用 \`read_scenario_file\` / \`write_scenario_file\` / \`validate_scenario\` / \`build_scenario\` 等工具时，默认使用上述 Project ID（除非用户明确指定其他项目）。
2. 项目目录位置已给出（Local Path），所有文件操作均相对于此目录。
3. **类型决定开发方式**：
   - 声明式（declarative）：编辑 \`scenario.json\` 配置文件 + \`prompts/*.md\` 提示词文件
   - 编程式（programmatic）：编辑 \`src/index.ts\` 入口文件 + \`scenario.json\` 元信息
4. 若用户未明确指定项目，且工具调用需要 \`project_id\` 参数，请使用上述 Project ID。
5. 当用户切换项目后，此上下文会自动更新；若你怀疑上下文过期，可调用 \`get_current_project\` 工具主动确认。`
}

/**
 * 动态上下文主入口：返回当前选中项目的格式化信息。
 * - 无选中项目时返回提示性段落，引导 AI 先帮用户创建或选择项目。
 */
export async function buildScenarioBuilderDynamicContext(): Promise<string | null> {
  const project = selectedProjectStore.getCurrent()
  if (!project) {
    return `## Current Scenario Project

用户当前未选中任何场景项目。在调用项目管理类工具（read_scenario_file / build_scenario 等）之前，请先：
1. 调用 \`list_scenario_projects\` 查看已有项目，并使用 \`set_current_project\` 设置当前项目；或
2. 调用 \`create_scenario_project\` 创建一个新项目（创建后会自动设为当前项目）。`
  }
  return formatProjectContext(project)
}
