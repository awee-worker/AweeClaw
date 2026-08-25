/**
 * 自定义智能体工具权限工具
 *
 * 职责：
 * - 读取当前激活的自定义智能体（AgentSelector 选中）
 * - 将智能体配置的 builtinTools（UI 分类 ID）解析为真实工具名
 * - 提供执行层权限判断（isToolAllowedForAgent）
 * - 提供工具加载上下文字段（getAgentToolLoadingFields），供 setToolLoadingContext 使用
 *
 * 规则：
 * - 未选择智能体 → 不施加任何限制（保持原流程）
 * - builtinTools / mcpServices / plugins 字段为数组 → 视为显式白名单
 * - 字段为 undefined（旧数据）→ 视为未配置，放行
 */

import { useStore } from '@store'

/** 自定义智能体配置（与 configTypes.ts 中 customAgentProfiles 项保持一致） */
export interface CustomAgentProfile {
  id: string
  name: string
  description: string
  systemPrompt: string
  capabilities: string[]
  priority: number
  enabled: boolean
  icon?: string
  identifier?: string
  callable?: boolean
  triggerMode?: 'always' | 'on_request' | 'manual'
  /** 关联的内置工具 ID 列表（UI 分类 ID） */
  builtinTools?: string[]
  /** 关联的 MCP 服务 ID 列表 */
  mcpServices?: string[]
  /** 关联的插件 ID 列表 */
  plugins?: string[]
  createdAt?: number
  updatedAt?: number
}

/**
 * UI「内置工具」分类 ID → 实际工具名映射
 *
 * 说明：CustomAgentPanel 中展示的是功能分类（glob/grep/bash/web_fetch 等），
 * 与真实工具名（search_files/run_command/read_url 等）不一致，
 * 需要在此建立映射；browser/computer_use/image_gen 为 MCP 工具，
 * 不映射内置工具，由 mcpServices 白名单控制。
 */
const AGENT_BUILTIN_TOOL_MAP: Record<string, string[]> = {
  read_file: ['read_file'],
  write_file: ['write_file'],
  edit_file: ['edit_file'],
  glob: ['search_files', 'list_directory', 'get_dir_tree', 'read_multiple_files', 'get_file_info'],
  grep: ['search_files'],
  bash: ['run_command', 'get_lint_errors'],
  web_search: ['web_search'],
  web_fetch: ['read_url'],
  code_action: ['edit_file', 'write_file', 'create_file_or_folder', 'delete_file_or_folder', 'replace_file_content'],
  browser: [],
  computer_use: [],
  image_gen: [],
}

/** 系统必需工具：不参与智能体白名单过滤（文档提取等基础设施） */
const ALWAYS_ALLOWED_TOOLS = new Set<string>(['extract_document'])

/** 读取当前激活的自定义智能体（未选择 / 已禁用返回 null） */
export function getActiveCustomAgent(): CustomAgentProfile | null {
  const agentConfig = useStore.getState().agentConfig
  if (!agentConfig?.activeCustomAgentId) return null
  const profile = agentConfig.customAgentProfiles?.find(
    (p) => p.id === agentConfig.activeCustomAgentId && p.enabled,
  )
  return profile || null
}

/** 将智能体的 builtinTools 分类 ID 解析为真实工具名集合 */
export function resolveAgentAllowedToolNames(profile: CustomAgentProfile): Set<string> {
  const names = new Set<string>()
  for (const id of profile.builtinTools ?? []) {
    const mapped = AGENT_BUILTIN_TOOL_MAP[id]
    if (mapped) {
      for (const name of mapped) names.add(name)
    } else if (id) {
      names.add(id)
    }
  }
  return names
}

/**
 * 判断某个工具名是否在智能体允许范围内（执行层兜底校验）
 *
 * @param toolName 实际工具名（如 read_file / mcp_mcp-playwright__browser_snapshot）
 * @param profile  激活的智能体；null 表示未选择，直接放行
 */
export function isToolAllowedForAgent(toolName: string, profile: CustomAgentProfile | null): boolean {
  if (!profile) return true

  // 系统必需工具不限制
  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return true

  // MCP 工具：按 serverId 白名单匹配（工具名形如 mcp_<serverId>__<tool>）
  if (toolName.startsWith('mcp_')) {
    const mcpServices = profile.mcpServices
    if (Array.isArray(mcpServices)) {
      if (mcpServices.length === 0) return false
      return mcpServices.some((id) => {
        if (toolName.startsWith(`mcp_${id}__`)) return true
        // 兼容 serverId 被 sanitize（特殊字符 → _）的情况
        const sanitized = `mcp_${id}`.replace(/[^a-zA-Z0-9_-]/g, '_')
        return toolName.startsWith(`${sanitized}__`)
      })
    }
    return true // 未配置 mcpServices → 放行
  }

  // 插件工具：按插件 ID 前缀匹配
  if (Array.isArray(profile.plugins) && profile.plugins.length > 0) {
    if (profile.plugins.some((pid) => toolName === pid || toolName.startsWith(`${pid}.`) || toolName.startsWith(`plugin_${pid}`))) {
      return true
    }
  }

  // 内置工具：builtinTools 为数组 → 显式白名单
  if (Array.isArray(profile.builtinTools)) {
    if (profile.builtinTools.length === 0) return false
    return resolveAgentAllowedToolNames(profile).has(toolName)
  }

  return true // builtinTools 未配置（旧数据）→ 放行
}

/**
 * 构建工具加载上下文的智能体字段（供 setToolLoadingContext / getToolsForContext 使用）
 * 返回 undefined 表示不施加限制，调用方可放心展开（...agentFields）
 */
export function getAgentToolLoadingFields(profile: CustomAgentProfile | null): {
  agentBuiltinTools?: string[]
  agentMcpServices?: string[]
} {
  if (!profile) return {}
  const fields: { agentBuiltinTools?: string[]; agentMcpServices?: string[] } = {}
  if (Array.isArray(profile.builtinTools)) {
    fields.agentBuiltinTools = Array.from(resolveAgentAllowedToolNames(profile))
  }
  if (Array.isArray(profile.mcpServices)) {
    fields.agentMcpServices = profile.mcpServices
  }
  return fields
}
