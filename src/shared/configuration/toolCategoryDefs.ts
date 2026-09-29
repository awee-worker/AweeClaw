/**
 * 工具分组与按需加载
 * 
 * 架构设计：
 * - 工具组：按功能分组的工具集合
 * - 内置工具：全量放行，不按工作模式或场景裁剪
 * - 角色工具：不同角色（模板）可以追加额外工具
 * - 场景工具：场景声明的 ToolPack / 自定义工具，只做追加
 * 
 * 加载规则：
 * - chat / agent / expert 三种模式：同一份全量内置工具（ALL_BUILTIN_TOOLS），
 *   模式差异只体现在审批策略上，不再体现在可用工具上
 * - 角色扩展：在全量内置工具基础上追加角色专属工具组
 * - 场景扩展：追加场景声明的 toolPacks（自动解析依赖）与直接声明的工具
 * - 按需暴露（与模式 / 场景无关）：git_*（需用户指令授权）、scene_tools_*、
 *   external_agent_*；另有套餐能力组白名单作为最后一道过滤
 * - 唯一例外：快速模式（chat）为免审批通道，授权后也不暴露 Git 写入类工具
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
  /**
   * 自定义智能体的工具白名单（兼容历史配置）
   *
   * 内置工具不受其约束 —— 全部内置工具无条件保留；该白名单只约束场景 / MCP 等
   * 追加来源。当前 UI 与 getAgentToolLoadingFields() 均不再下发此字段。
   */
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
   * 是否暴露 Git 工具（git_*）。
   *
   * 缺省为 false —— git_* 工具默认不对 LLM 可见：
   * 工作区并不都是 Git 仓库，AI 在接手任务时先跑一遍 git_status / git_log「探路」
   * 会稳定失败，既污染上下文，也让用户误以为环境出了问题。
   *
   * 仅当用户最新消息带有明确的版本控制指令（提交 / 分支 / 合并 / 差异 / 历史 /
   * 拉取推送 / 工作树 / 审计封存等）时，由上层（loopDetector / AgentSubLoop /
   * voiceToolLoop / PromptComposer）计算后置为 true，即由用户在指令中授权。
   *
   * 置为 true 后三种模式一致下发只读工具；写入类工具（commit / branch / sync /
   * worktree / audit）仅下发给 agent / expert —— 快速模式（chat）为免审批通道，
   * 即便授权也不暴露写仓库能力。
   */
  gitToolsEnabled?: boolean
  /**
   * 是否暴露外部编码智能体工具（external_agent_*）。
   *
   * 缺省为 false —— 外部智能体工具默认不对 LLM 可见，
   * 仅当用户在「设置 → 外部智能体」中开启“向 AI 暴露工具”后由上层置为 true。
   */
  externalAgentEnabled?: boolean

  /**
   * 套餐授权的工具能力组白名单（来自 featureGuardService）
   *
   * - `undefined`：未配置 / 权益快照不可信 → 不做限制（fail-open）
   * - 数组：仅保留白名单组内工具 + 系统必需工具
   */
  allowedToolGroups?: string[]
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
  // 内置浏览器预览（本地页面 / 本地服务地址在应用内打开）
  'open_preview',
  // 预览页面健康自检（控制台错误 / 加载失败 / 白屏）
  'inspect_preview',
  // 定时任务
  'schedule',
  // Skill 按需加载
  'apply_skill',
  // 任务列表
  'todo_write',
  // Graph Runtime 动态建图（graphVersion=2 执行期可用，无活跃图时工具返回友好错误）
  'add_node',
  'add_edge',
  // Git 只读工具（状态 / 差异 / 历史）：实际是否下发由 gitToolsEnabled 门控决定
  'git_status',
  'git_diff',
  'git_log',
]

/**
 * Git 只读工具（状态 / 差异 / 历史）
 */
const GIT_READ_TOOLS: string[] = [
  'git_status',
  'git_diff',
  'git_log',
]

/**
 * Git 写入类工具
 *
 * chat 模式为「免审批」通道，若允许直接 commit / 切分支 / push，
 * 用户在聊天里让 AI "帮我提交一下"就可能在没有审阅 diff 的情况下改到仓库，
 * 因此这组只挂在 agent / expert 模式（其审批门禁由 approvalType='terminal' 驱动）。
 */
const GIT_WRITE_TOOLS: string[] = [
  'git_commit',
  'git_branch',
  'git_sync',
  // 链接工作树：会在工作区同级目录新建工作目录（有副作用的"重"操作）
  'git_worktree',
  // 审计封存：会提交未提交变更并打审计 tag
  'git_audit',
]

/**
 * Git 工具名（供「按需暴露」门控与执行层兜底校验共用）
 *
 * - `GIT_READ_TOOL_NAMES`：只读，授权后三种模式一致下发
 * - `GIT_WRITE_TOOL_NAMES`：写入，授权后仅下发给 agent / expert
 */
export const GIT_READ_TOOL_NAMES: readonly string[] = [...GIT_READ_TOOLS]
export const GIT_WRITE_TOOL_NAMES: readonly string[] = [...GIT_WRITE_TOOLS]
export const GIT_TOOL_NAMES: readonly string[] = [...GIT_READ_TOOLS, ...GIT_WRITE_TOOLS]

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

/**
 * 全量内置工具 —— 三种工作模式与所有场景共用同一份内置工具集
 *
 * 语义：内置工具是平台能力，不按工作模式或场景裁剪。
  * 当前产品策略固定为专家档（expert）；场景能力项仍可声明历史能力，但不再作为可切换工作模式入口。选择场景不会减少
 * 可用内置工具；模式与场景只做「追加」——渠道工具、场景声明的工具包与自定义工具、
 * 角色专属工具组、MCP 插件、场景工具桥接、外部智能体桥接。
 *
 * 仅保留两类与「模式 / 场景」无关的门控（见 getToolsForContext）：
 * - `git_*`：需用户当轮指令授权后才下发（工作区并非都是 Git 仓库）
 * - `scene_tools_*` / `external_agent_*`：按需暴露
 * 另有套餐能力组白名单作为最后一道统一过滤。
 *
 * 例外：本集合包含 Git 写入类工具，但快速模式（chat）在 git 门控处会再剔除它们
 * —— 见 getToolsForContext 第 6 步。该例外不改变本集合「全量」的语义。
 */
const ALL_BUILTIN_TOOLS: string[] = Array.from(new Set([
  ...CORE_TOOLS,
  ...GIT_WRITE_TOOLS,
  ...UIUX_TOOLS,
  ...PLAN_PLANNING_TOOLS,
  ...PLAN_EXECUTION_CONTROL_TOOLS,
  ...PLAN_EXPLORATION_TOOLS,
  // 系统强制注入：文档提取与交互提问（不依赖任何工具包）
  'extract_document',
  'ask_user',
]))

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

// ============================================
// 能力组（套餐授权粒度）
// ============================================

/**
 * 套餐授权用的「能力组」定义
 *
 * 与上面的「工具组」（TOOL_GROUPS，用于按模式/角色加载工具）不是同一概念：
 * 能力组是套餐白名单的授权粒度，组内工具由代码维护，客户端新增工具只要
 * 归入既有组，无需回后台重新勾选。
 *
 * ⚠️ 必须与后端 `aweeclaw-backend/src/modules/payment/tool-catalog.ts` 逐项对齐：
 * 组 ID 与工具归属不一致会出现「后台勾了却用不了」的错位。
 * 后端 `GET /api/v1/payment/tool-catalog` 返回权威目录，可用于比对。
 */
export interface CapabilityGroupConfig {
  id: string
  name: string
  nameEn: string
  tools: string[]
}

/** 能力组目录（需与后端 tool-catalog.ts 保持一致） */
export const CAPABILITY_GROUPS: CapabilityGroupConfig[] = [
  {
    id: 'file',
    name: '文件读写',
    nameEn: 'File Access',
    tools: [
      'read_file',
      'read_multiple_files',
      'list_directory',
      'get_dir_tree',
      'get_file_info',
      'write_file',
      'edit_file',
      'replace_file_content',
      'create_file_or_folder',
      'delete_file_or_folder',
    ],
  },
  {
    id: 'code',
    name: '代码智能',
    nameEn: 'Code Intelligence',
    tools: [
      'codebase_search',
      'search_files',
      'get_lint_errors',
      'find_references',
      'go_to_definition',
      'get_hover_info',
      'get_document_symbols',
    ],
  },
  {
    id: 'terminal',
    name: '终端命令',
    nameEn: 'Terminal',
    // Git 工具与终端同属「在工作区执行操作」能力：
    // 归入既有组可保证已授权终端能力的用户无需回后台重新勾选即可使用
    tools: [
      'run_command',
      'read_terminal_output',
      'send_terminal_input',
      'stop_terminal',
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_branch',
      'git_sync',
      'git_worktree',
      'git_audit',
    ],
  },
  {
    id: 'web',
    name: '网络检索',
    nameEn: 'Web & Search',
    tools: ['web_search', 'read_url', 'get_weather'],
  },
  {
    id: 'media',
    name: '多模态与图表',
    nameEn: 'Media & Vision',
    tools: [
      'image_search',
      'video_search',
      'ocr_extract',
      'vision_analyze',
      'chart_generate',
    ],
  },
  {
    id: 'knowledge',
    name: '记忆与知识',
    nameEn: 'Memory & Knowledge',
    tools: ['remember', 'knowledge_search', 'calculator'],
  },
  {
    id: 'automation',
    name: '任务与自动化',
    nameEn: 'Task & Automation',
    tools: [
      'todo_write',
      'ask_user',
      'create_task_plan',
      'update_task_plan',
      'start_task_execution',
      'add_node',
      'add_edge',
      'schedule',
      'apply_skill',
    ],
  },
  {
    id: 'companion',
    name: '伴侣与交互',
    nameEn: 'Companion & Interaction',
    // open_preview：内置浏览器预览，属「在应用内与用户交互」的能力，与伴侣控制同组
    tools: ['companion_control', 'open_preview', 'inspect_preview', 'uiux_search', 'uiux_recommend'],
  },
]

/** 工具名 → 能力组 ID 反查表 */
const TOOL_TO_CAPABILITY_GROUP = new Map<string, string>(
  CAPABILITY_GROUPS.flatMap((group) =>
    group.tools.map((tool) => [tool, group.id] as [string, string]),
  ),
)

/** 系统必需工具：任何套餐都放行（与后端 ALWAYS_ALLOWED_TOOLS 对齐） */
export const PLAN_ALWAYS_ALLOWED_TOOLS: readonly string[] = [
  'extract_document',
  'ask_user',
  'todo_write',
  'send_file_to_channel',
]

/** 查询工具所属能力组 */
export function getToolCapabilityGroup(toolName: string): string | undefined {
  return TOOL_TO_CAPABILITY_GROUP.get(toolName)
}

/**
 * 判断工具是否被套餐能力组白名单授权
 *
 * @param toolName          工具名
 * @param allowedToolGroups 授权的组；`undefined` = 未配置 → 全放行
 */
export function isToolAllowedByPlanGroups(
  toolName: string,
  allowedToolGroups: string[] | undefined,
): boolean {
  // 未配置 → 全放行（兼容上线前数据，也用于权益不可信时的 fail-open）
  if (allowedToolGroups === undefined) return true
  // 系统必需工具永远放行
  if (PLAN_ALWAYS_ALLOWED_TOOLS.includes(toolName)) return true
  // 目录未登记的工具（MCP / 场景 / 插件 / 外部智能体）不受套餐能力组限制
  const groupId = TOOL_TO_CAPABILITY_GROUP.get(toolName)
  if (groupId === undefined) return true
  return allowedToolGroups.includes(groupId)
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
 * 内置工具全量放行：专家档（expert）以及所有
 * 场景，都能使用全部内置工具（ALL_BUILTIN_TOOLS）。模式与场景只做追加：
 * - 渠道会话追加渠道工具（send_file_to_channel）
 * - 场景追加 toolPacks（自动解析依赖）与直接声明的工具名
 * - 角色追加专属工具组
 *
 * 仍保留的过滤 / 门控：
 * - git_*：需用户当轮指令授权后才下发（工作区并非都是 Git 仓库）；授权后
 *   快速模式（chat）仍不暴露写入类工具 —— 唯一一处按模式裁剪，且只作用于 Git 门控层
 * - scene_tools_* / external_agent_*：按需暴露
 * - 套餐能力组白名单：最后一道统一过滤
 */
export function getToolsForContext(context: ToolLoadingContext): string[] {
  // 1. 内置工具全量放行（不按工作模式或场景裁剪）
  let tools = new Set<string>(ALL_BUILTIN_TOOLS)

  // 2. 渠道工具：环境能力，仅消息渠道会话（飞书/微信等）可调用
  if (context.isChannel) {
    for (const tool of CHANNEL_TOOLS) {
      tools.add(tool)
    }
  }

  // 3. 场景追加：工具包（自动解析依赖）与声明式场景直接声明的工具名
  //    只增不减 —— 场景不再影响内置工具的可用性
  const scenarioPacks = context.scenarioToolPacks
  if (scenarioPacks && scenarioPacks.length > 0) {
    for (const tool of toolPackRegistry.resolveTools(scenarioPacks)) {
      tools.add(tool)
    }
  }
  const scenarioTools = context.scenarioTools
  if (scenarioTools && scenarioTools.length > 0) {
    for (const tool of scenarioTools) {
      tools.add(tool)
    }
  }

  // 4. 角色专属工具组（含第三方 registerToolGroup 注册的自定义组）
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

  // 5. 智能体白名单兜底（兼容历史配置）：智能体不限制内置工具 —— 全部内置工具
  //    无条件保留，该白名单只约束场景 / MCP 等追加来源
  if (context.agentBuiltinTools !== undefined) {
    const allow = new Set(context.agentBuiltinTools)
    for (const tool of ALL_BUILTIN_TOOLS) {
      allow.add(tool)
    }
    tools = new Set(Array.from(tools).filter((tool) => allow.has(tool)))
  }

  // 6. Git 工具（git_*）为「按需暴露」：
  //     - 默认不下发给 LLM：工作区并非都是 Git 仓库，AI 自行「探路」
  //       （先跑一遍 git_status / git_log）会稳定失败，只会污染上下文；
  //     - 仅当用户本轮明确要求版本控制操作（提交 / 分支 / 差异 / 历史 / 拉取推送 …）时，
  //       由上层计算 gitToolsEnabled=true 后下发；
  //     - 即便授权，快速模式（chat）作为免审批通道仍不暴露写入类工具
  //       （commit / branch / sync / worktree / audit），避免未经审阅 diff 就改到仓库。
  //       这是「按模式裁剪」的唯一例外，且位于 Git 门控层，不改变内置工具集本身；
  //       写入操作另由 approvalType='terminal' 强制审批，两道门禁互为补充。
  if (context.gitToolsEnabled !== true) {
    tools = new Set(Array.from(tools).filter((tool) => !GIT_TOOL_NAMES.includes(tool)))
  } else if (context.mode === 'chat') {
    tools = new Set(Array.from(tools).filter((tool) => !GIT_WRITE_TOOLS.includes(tool)))
  }

  // 7. 场景工具（scene_tools_*）为“按需暴露”：
  //    - 仅当 sceneToolsEnabled === true 时附加（上层根据用户消息意图判定）
  //    - 不再无条件对所有对话/任务可见（致命问题 #4）：
  //      AI 执行任务时不得自动调用场景工具，任务跟踪应使用系统内置 todo_write 等
  if (context.sceneToolsEnabled === true) {
    for (const tool of SCENE_TOOL_NAMES) {
      tools.add(tool)
    }
  }

  // 8. 外部编码智能体工具（external_agent_*）为“按需暴露”：
  //    仅当 externalAgentEnabled === true（用户在设置面板开启“向 AI 暴露”）时附加
  if (context.externalAgentEnabled === true) {
    for (const tool of EXTERNAL_AGENT_TOOL_NAMES) {
      tools.add(tool)
    }
  }

  // 9. 套餐能力组白名单过滤（置于最后一道，对全部来源的工具统一生效）
  //    未配置（undefined）→ 全放行；目录未登记的工具（MCP / 场景 / 插件）不受此限制
  if (context.allowedToolGroups !== undefined) {
    tools = new Set(
      Array.from(tools).filter((tool) =>
        isToolAllowedByPlanGroups(tool, context.allowedToolGroups),
      ),
    )
  }

  return Array.from(tools)
}


/**
 * 检查工具是否在上下文中可用
 */
export function isToolAvailable(toolName: string, context: ToolLoadingContext): boolean {
  return getToolsForContext(context).includes(toolName)
}
