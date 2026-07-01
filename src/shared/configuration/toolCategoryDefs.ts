/**
 * 工具分组与按需加载
 * 
 * 架构设计：
 * - 工具组：按功能分组的工具集合
 * - 模式工具：不同工作模式（agent/chat）加载不同工具
 * - 角色工具：不同角色（模板）可以扩展额外工具
 * - 场景工具：不同场景加载不同的 ToolPack
 * 
 * 加载规则：
 * - chat 模式：core 工具组（或场景指定的 ToolPack），免审批
 * - agent 模式：core 工具组（或场景指定的 ToolPack），需审批
 * - 角色扩展：在模式基础上添加角色专属工具组
 * - 场景扩展：场景声明 toolPacks，自动解析依赖
 */

import type { WorkMode } from '@protocols/workModeProtocol'
import { toolPackRegistry } from './toolPacks'

// ============================================
// 类型定义
// ============================================

/** 工具组配置 */
export interface ToolGroupConfig {
  id: string
  name: string
  tools: string[]
}

/** 工具加载上下文 */
export interface ToolLoadingContext {
  /** 工作模式 */
  mode: WorkMode
  /** 角色模板 ID（可选） */
  templateId?: string
  /** Plan 阶段：planning = 只有编排工具, executing = 所有工具 */
  planPhase?: 'planning' | 'executing'
  /** 场景 ID（可选）：场景指定的 ToolPack 优先于默认工具组 */
  scenarioId?: string
  /** 场景工具包列表（可选）：直接指定需要的工具包 */
  scenarioToolPacks?: string[]
}

/** 角色工具配置 */
export interface TemplateToolConfig {
  /** 角色需要的额外工具组 */
  toolGroups: string[]
}

// ============================================
// 工具组定义
// ============================================

/** 核心工具 - agent 模式使用 */
const CORE_TOOLS: string[] = [
  // 文件读取
  'read_file',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'read_multiple_files',
  // 文档提取（PDF/Word/Excel/PPT 等二进制格式）
  'extract_document',
  // 文件编辑
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
  // 终端
  'run_command',
  'get_lint_errors',
  // 代码智能
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',

  // 搜索
  'codebase_search',
  // 网络
  'web_search',
  'read_url',
  // 交互与记忆
  'remember',
  'knowledge_search',
  // 定时任务
  'schedule',
  // Skill 按需加载
  'apply_skill',
  // 任务列表
  'todo_write',
  // 渠道交互
  'send_file_to_channel',
]

/** UI/UX 工具 - uiux-designer 角色专用 */
const UIUX_TOOLS: string[] = [
  'uiux_search',
  'uiux_recommend',
]

/** Channel 工具 - 渠道消息交互专用 */
const CHANNEL_TOOLS: string[] = [
  'send_file_to_channel',
]

/** Plan 规划工具 - 仅用于需求收集、计划创建与计划修订 */
const PLAN_PLANNING_TOOLS: string[] = [
  'ask_user',
  'create_task_plan',
  'update_task_plan',
]

/** Plan 执行控制工具 - 仅在进入执行阶段后可用 */
const PLAN_EXECUTION_CONTROL_TOOLS: string[] = [
  'start_task_execution',
]

const PLAN_EXPLORATION_TOOLS: string[] = [
  'read_file',
  'read_multiple_files',
  'extract_document',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'codebase_search',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'get_file_info',
]

/** 工具组注册表 */
const TOOL_GROUPS: Record<string, string[]> = {
  core: CORE_TOOLS,
  uiux: UIUX_TOOLS,
  channel: CHANNEL_TOOLS,
  plan: PLAN_PLANNING_TOOLS,
}

/** 角色工具配置注册表 */
const TEMPLATE_TOOLS: Record<string, TemplateToolConfig> = {
  'uiux-designer': { toolGroups: ['uiux'] },
}

// ============================================
// 工具组管理
// ============================================

/**
 * 注册工具组
 */
export function registerToolGroup(id: string, tools: string[]): void {
  TOOL_GROUPS[id] = tools
}

/**
 * 注册角色工具配置
 */
export function registerTemplateTools(templateId: string, config: TemplateToolConfig): void {
  TEMPLATE_TOOLS[templateId] = config
}

/**
 * 获取工具组
 */
export function getToolGroup(id: string): string[] | undefined {
  return TOOL_GROUPS[id]
}

// ============================================
// 工具加载
// ============================================

/**
 * 根据上下文获取工具列表
 *
 * 加载规则：
 * - chat: core 工具组（或场景 ToolPack），免审批
 * - agent: core 工具组（或场景 ToolPack），需审批
 * - plan: plan 规划工具组（ask_user, create_task_plan, update_task_plan）
 * - 角色: 在模式基础上 + 角色专属工具组
 * - 场景: 场景声明 toolPacks，自动解析依赖
 */
export function getToolsForContext(context: ToolLoadingContext): string[] {
  const tools = new Set<string>()

  const scenarioPacks = context.scenarioToolPacks
  if (scenarioPacks && scenarioPacks.length > 0) {
    const packTools = toolPackRegistry.resolveTools(scenarioPacks)
    for (const tool of packTools) {
      tools.add(tool)
    }
  }

  // 文档提取工具在所有模式、所有场景下都无条件可用
  // （用户上传 PDF/Word/Excel 等二进制文档时必须能用 extract_document 提取）
  tools.add('extract_document')

  if (context.mode === 'chat') {
    if (!scenarioPacks || scenarioPacks.length === 0) {
      for (const tool of CORE_TOOLS) {
        tools.add(tool)
      }
    }
    if (context.templateId) {
      const templateConfig = TEMPLATE_TOOLS[context.templateId]
      if (templateConfig) {
        for (const groupId of templateConfig.toolGroups) {
          const groupTools = TOOL_GROUPS[groupId]
          if (groupTools) {
            for (const tool of groupTools) {
              tools.add(tool)
            }
          }
        }
      }
    }
    return Array.from(tools)
  }

  // plan 模式：专家模式拥有最大权限，所有阶段均可使用全部工具
  if (context.mode === 'plan') {
    if (!scenarioPacks || scenarioPacks.length === 0) {
      for (const tool of CORE_TOOLS) {
        tools.add(tool)
      }
    }
    for (const tool of TOOL_GROUPS['plan'] || []) {
      tools.add(tool)
    }
    for (const tool of PLAN_EXECUTION_CONTROL_TOOLS) {
      tools.add(tool)
    }
    for (const tool of PLAN_EXPLORATION_TOOLS) {
      tools.add(tool)
    }
    return Array.from(tools)
  }

  // 1. Agent 模式：core 工具（如果场景已提供工具包则跳过默认 core）
  if (!scenarioPacks || scenarioPacks.length === 0) {
    for (const tool of CORE_TOOLS) {
      tools.add(tool)
    }
  }

  // 2. 添加角色专属工具
  if (context.templateId) {
    const templateConfig = TEMPLATE_TOOLS[context.templateId]
    if (templateConfig) {
      for (const groupId of templateConfig.toolGroups) {
        const groupTools = TOOL_GROUPS[groupId]
        if (groupTools) {
          for (const tool of groupTools) {
            tools.add(tool)
          }
        }
      }
    }
  }

  return Array.from(tools)
}

/**
 * 检查工具是否在上下文中可用
 */
export function isToolAvailable(toolName: string, context: ToolLoadingContext): boolean {
  return getToolsForContext(context).includes(toolName)
}
