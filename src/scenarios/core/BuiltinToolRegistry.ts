/**
 * 内置工具注册表
 *
 * 为声明式场景提供内置工具的引用能力。
 * 场景配置中通过 tools.builtin 引用内置工具名称，
 * 本注册表负责查找并返回对应的工具定义和执行器。
 */

import { toolRegistry } from '@/renderer/agent/tools/registry'
import type { ScenarioToolDefinition } from '@shared/types/scenario-arch'
import type { ToolDefinition, ToolExecutor } from '@/shared/types'

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
  'get_lint_errors',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'web_search',
  'read_url',
  'ask_user',
  'todo_write',
  'sql_query',
  'data_transform',
  'csv_analyze',
  'chart_generate',
  'statistical_test',
  'remember',
  'knowledge_search',
])

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
