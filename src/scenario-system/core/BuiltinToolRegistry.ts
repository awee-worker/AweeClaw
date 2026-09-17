/**
 * 内置工具注册表
 *
 * 为声明式场景提供内置工具的引用能力。
 * 场景配置中通过 tools.builtin 引用内置工具名称，
 * 本注册表负责查找并返回对应的工具定义和执行器。
 */

import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import type { ToolDefinition, ToolExecutor } from '../providerTypes'

const AVAILABLE_BUILTIN_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'codebase_search',
  'edit_file',
  'write_file',
  'create_file_or_folder',
  'delete_file_or_folder',
  'run_command',
  'read_terminal_output',
  'send_terminal_input',
  'stop_terminal',
  // Git 版本控制（工作区仓库操作；网络命令由客户端统一处理凭证）
  'git_status',
  'git_diff',
  'git_log',
  'git_commit',
  'git_branch',
  'git_sync',
  'git_worktree',
  'git_audit',
  'get_lint_errors',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'web_search',
  'read_url',
  'ask_user',
  'todo_write',
  // 数据类：以下 5 项已在 toolDefinitions.ts 定义工具描述，但 toolExecutors.ts
  // 尚未实现执行器（预留能力）。保留在此是为了维持与 BUILTIN_TOOL_OPTIONS /
  // BUILTIN_TOOLS / 双语 i18n 的 37 项一一对应；isAvailable() 会通过
  // toolRegistry.has() 二次校验并返回 false，不会产生静默误判。
  'sql_query',
  'data_transform',
  'csv_analyze',
  'chart_generate',
  'statistical_test',
  'remember',
  'knowledge_search',
  'companion_control',
])
// 说明：本白名单的语义是「允许声明式场景引用的内置工具集合」（共 37 项），
// 因此包含上述 5 项预留能力；真正的可执行性以 toolRegistry.has() 为准（见 isAvailable）。
//
// 与工具包（toolPacks.ts）的区别：
//   - 工具包区分 tools / reservedTools，reservedTools 不参与 resolveTools() 解析，
//     因此预留工具不会进入 LLM 工具列表与系统提示词；
//   - 本白名单服务于「声明式场景」路径，预留项由 isAvailable() 兜底拒绝。
// 预留工具清单与维护要求见 aweeclaw-docs/guide/builtin-tools.md。

class BuiltinToolRegistryClass {
  private available: ReadonlySet<string>

  constructor(tools: ReadonlySet<string>) {
    this.available = tools
  }

  isAvailable(toolName: string): boolean {
    return this.available.has(toolName) && toolRegistry.has(toolName)
  }

  getToolDefinition(toolName: string): ScenarioToolDefinition | null {
    if (!this.isAvailable(toolName)) return null

    const registered = toolRegistry.get(toolName)
    if (!registered) return null

    return {
      name: toolName,
      definition: registered.definition,
      executor: registered.getExecutor() as ToolExecutor,
    }
  }

  getToolDefinitions(toolNames: string[]): ScenarioToolDefinition[] {
    const results: ScenarioToolDefinition[] = []
    for (const name of toolNames) {
      const def = this.getToolDefinition(name)
      if (def) {
        results.push(def)
      }
    }
    return results
  }

  getAvailableToolNames(): string[] {
    return Array.from(this.available).filter(name => toolRegistry.has(name))
  }

  getToolDefinitionForConfig(toolName: string): ToolDefinition | null {
    const registered = toolRegistry.get(toolName)
    return registered?.definition ?? null
  }
}

export const builtinToolRegistry = new BuiltinToolRegistryClass(AVAILABLE_BUILTIN_TOOLS)
