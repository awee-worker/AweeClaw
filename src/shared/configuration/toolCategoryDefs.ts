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
  /** 场景直接声明的工具名列表（用于声明式场景，无需 toolPack 注册） */
  scenarioTools?: string[]
  /** 是否为消息渠道会话（飞书/微信等），仅渠道会话才注入 send_file_to_channel 等渠道工具 */
  isChannel?: boolean
  /** 自定义智能体允许的内置工具名白名单（已解析为真实工具名；存在时内置工具仅保留白名单内） */
  agentBuiltinTools?: string[]
  /** 自定义智能体允许的 MCP 服务 ID 白名单（存在时仅暴露白名单内 MCP 服务器的工具） */
  agentMcpServices?: string[]
  /**
   * 是否暴露场景工具（scene_tools_*）。
   *
   * 缺省为 false —— 场景工具不再无条件对 LLM 可见（致命问题 #4）：
   * AI 在执行开发/多步任务时不得自动调用场景工具（如自动创建 work-todo 任务清单），
   * 其自身任务跟踪应使用系统内置 todo_write / create_task_plan / schedule。
   *
   * 仅当用户最新消息带有明确的“场景数据记录/查询/管理”意图时，由上层
   * （loopDetector / AgentSubLoop / voiceToolLoop / PromptComposer）计算后置为 true。
   */
  sceneToolsEnabled?: boolean
  /**
   * 是否暴露外部编码智能体工具（external_agent_*）。
   *
   * 缺省为 false —— 外部智能体工具默认不对 LLM 可见，
   * 仅当用户在「设置 → 外部智能体」中开启“向 AI 暴露工具”后由上层置为 true。
   */
  externalAgentEnabled?: boolean
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
  'read_terminal_output',
  'send_terminal_input',
  'stop_terminal',
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
  'image_search',
  'video_search',
  // 交互与记忆
  'remember',
  'knowledge_search',
  // 桌面伴侣控制（VRM 角色动作 / 表情 / 说话）
  'companion_control',
  // 定时任务
  'schedule',
  // Skill 按需加载
  'apply_skill',
  // 任务列表
  'todo_write',
  // Graph Runtime 动态建图（graphVersion=2 执行期可用，无活跃图时工具返回友好错误）
  'add_node',
  'add_edge',
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

/** 外部编码智能体 AI 桥接工具名（external_agent_*，按需暴露：externalAgentEnabled === true 时附加） */
export const EXTERNAL_AGENT_TOOL_NAMES: readonly string[] = [
  'external_agent_delegate',
  'external_agent_status',
  'external_agent_abort',
]

/** 场景工具 AI 桥接工具名（scene_tools_*） */
export const SCENE_TOOL_NAMES: readonly string[] = [
  'scene_tools_list',
  'scene_tools_read',
  'scene_tools_add',
  'scene_tools_update',
  'scene_tools_delete',
  'scene_tools_stats',
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
  let tools = new Set<string>()

  const scenarioPacks = context.scenarioToolPacks
  const scenarioTools = context.scenarioTools
  if (scenarioPacks && scenarioPacks.length > 0) {
    const packTools = toolPackRegistry.resolveTools(scenarioPacks)
    for (const tool of packTools) {
      tools.add(tool)
    }
  }
  // 声明式场景直接声明的工具名（无需 toolPack 注册）
  if (scenarioTools && scenarioTools.length > 0) {
    for (const tool of scenarioTools) {
      tools.add(tool)
    }
  }

  // 文档提取工具在所有模式、所有场景下都无条件可用
  // （用户上传 PDF/Word/Excel 等二进制文档时必须能用 extract_document 提取）
  tools.add('extract_document')

  // 渠道工具仅在消息渠道会话中可用（飞书/微信等），普通聊天不可用
  if (context.isChannel) {
    for (const tool of CHANNEL_TOOLS) {
      tools.add(tool)
    }
  }

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
  } else if (context.mode === 'plan') {
    // plan 模式：专家模式拥有最大权限，所有阶段均可使用全部工具
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
  } else {
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
  }

  // 3. 自定义智能体白名单过滤：激活了智能体且配置了 builtinTools 时，
  //    内置工具仅保留白名单内的（extract_document 为系统必需工具，始终保留）
  //    空数组表示不允许任何内置工具
  if (context.agentBuiltinTools !== undefined) {
    const allow = new Set(context.agentBuiltinTools)
    allow.add('extract_document')
    tools = new Set(Array.from(tools).filter((tool) => allow.has(tool)))
  }

  // 4. 场景工具（scene_tools_*）为“按需暴露”：
  //    - 仅当 sceneToolsEnabled === true 时附加（上层根据用户消息意图判定）
  //    - 不再无条件对所有对话/任务可见（致命问题 #4）：
  //      AI 执行任务时不得自动调用场景工具，任务跟踪应使用系统内置 todo_write 等
  if (context.sceneToolsEnabled === true) {
    for (const tool of SCENE_TOOL_NAMES) {
      tools.add(tool)
    }
  }

  // 5. 外部编码智能体工具（external_agent_*）为“按需暴露”：
  //    仅当 externalAgentEnabled === true（用户在设置面板开启“向 AI 暴露”）时附加
  if (context.externalAgentEnabled === true) {
    for (const tool of EXTERNAL_AGENT_TOOL_NAMES) {
      tools.add(tool)
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
