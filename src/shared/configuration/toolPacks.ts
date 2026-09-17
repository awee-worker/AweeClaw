/**
 * ToolPack System - 工具包系统
 *
 * 将扁平的工具配置组织为分层的工具包，支持按场景动态加载。
 * 每个工具包声明一组相关工具，场景通过 toolPacks 字段引用。
 *
 * 设计原则：
 * - 工具包是工具的逻辑分组
 * - 场景声明需要的工具包，运行时合并
 * - 第三方可通过 MCP 协议动态注册工具包
 * - 向后兼容：现有工具自动归入 'code' 工具包
 */

// ============================================
// ToolPack 类型定义
// ============================================

export interface ToolPack {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon?: string
  category: ToolPackCategory
  /**
   * 已接入内置执行器、可被场景实际调用的工具名。
   * 只有列在这里（或 optionalTools）的工具才会被 resolveTools() 解析并暴露给 LLM。
   */
  tools: string[]
  /** 可选工具：需 resolveTools(packs, includeOptional = true) 才启用 */
  optionalTools?: string[]
  /**
   * 预留工具：已规划（部分已有工具描述），但**尚未接入内置执行器**。
   *
   * 这些工具不参与 resolveTools() 解析，因此不会进入 LLM 工具列表与系统提示词，
   * 避免 AI 调用后落到 `Unknown tool` 失败。
   * 执行器补齐后，把工具名从 reservedTools 移入 tools 即可自动生效。
   */
  reservedTools?: string[]
  dependencies?: string[]
}

export type ToolPackCategory =
  | 'code'
  | 'data'
  | 'web'
  | 'media'
  | 'office'
  | 'communication'
  | 'automation'
  | 'custom'

// ============================================
// 内置工具包定义
// ============================================

const CODE_TOOL_PACK: ToolPack = {
  id: 'code',
  name: 'Code Tools',
  nameZh: '代码工具',
  description: 'File operations, code search, terminal, and LSP tools',
  descriptionZh: '文件操作、代码搜索、终端和 LSP 工具',
  icon: 'Code2',
  category: 'code',
  // 与 toolCategoryDefs.CORE_TOOLS 保持对齐（默认 agent 模式的工具集），
  // 避免「场景声明 code 包」反而比默认模式少工具
  tools: [
    // 文件读取（extract_document 为系统强制注入工具，不属于任何包，见 getToolsForContext）
    'read_file',
    'list_directory',
    'search_files',
    // 文件编辑
    'edit_file',
    'write_file',
    'create_file_or_folder',
    'delete_file_or_folder',
    // 终端
    'run_command',
    'read_terminal_output',
    'send_terminal_input',
    'stop_terminal',
    // Git（工作区仓库操作，网络命令自动处理凭证）
    'git_status',
    'git_diff',
    'git_log',
    'git_commit',
    'git_branch',
    'git_sync',
    // Git 隔离与审计（worktree 并行隔离 / 合规审计封存）
    'git_worktree',
    'git_audit',
    // 代码智能
    'get_lint_errors',
    'find_references',
    'go_to_definition',
    'get_hover_info',
    'get_document_symbols',
    'codebase_search',
    // 网络
    'web_search',
    'read_url',
    'image_search',
    'video_search',
    // 记忆与知识
    'remember',
    'knowledge_search',
    'apply_skill',
    // 交互与规划
    'ask_user',
    'todo_write',
    'schedule',
    // Graph Runtime 动态建图（graphVersion=2）
    'add_node',
    'add_edge',
    // 桌面伴侣控制（VRM 角色动作 / 表情 / 说话）
    'companion_control',
  ],
  optionalTools: [
    'uiux_search',
    'uiux_recommend',
  ],
  // 历史遗留名，无工具定义也无执行器：
  // - get_dir_tree：能力已并入 list_directory（递归模式）
  // - read_multiple_files：能力已并入 read_file（支持 paths 数组）
  // - replace_file_content：能力已并入 edit_file
  reservedTools: [
    'get_dir_tree',
    'read_multiple_files',
    'replace_file_content',
  ],
}

const DATA_TOOL_PACK: ToolPack = {
  id: 'data',
  name: 'Data Tools',
  nameZh: '数据工具',
  description: 'Database queries, data transformation, and statistical analysis',
  descriptionZh: '数据库查询、数据转换和统计分析',
  icon: 'BarChart3',
  category: 'data',
  // 暂无内置执行器：工具描述已在 toolDefinitions.ts 定义，但 toolExecutors.ts 未实现
  tools: [],
  reservedTools: [
    'sql_query',
    'data_transform',
    'csv_analyze',
    'chart_generate',
    'statistical_test',
    'rest_api',
  ],
  dependencies: ['code'],
}

const WEB_TOOL_PACK: ToolPack = {
  id: 'web',
  name: 'Web Tools',
  nameZh: '网页工具',
  description: 'Web scraping, API calls, and browser automation',
  descriptionZh: '网页抓取、API 调用和浏览器自动化',
  icon: 'Globe',
  category: 'web',
  // 暂无内置执行器（连工具定义也尚未补齐）
  tools: [],
  reservedTools: [
    'web_scrape',
    'api_call',
    'browser_automate',
  ],
  dependencies: ['code'],
}

const MEDIA_TOOL_PACK: ToolPack = {
  id: 'media',
  name: 'Media Tools',
  nameZh: '媒体工具',
  description: 'Image generation, audio transcription, and media processing',
  descriptionZh: '图像生成、音频转录和媒体处理',
  icon: 'Image',
  category: 'media',
  // 暂无内置执行器：工具描述已在 toolDefinitions.ts 定义，但 toolExecutors.ts 未实现
  tools: [],
  reservedTools: [
    'image_generate',
    'image_edit',
    'audio_transcribe',
    'video_analyze',
  ],
  dependencies: ['code'],
}

const OFFICE_TOOL_PACK: ToolPack = {
  id: 'office',
  name: 'Office Tools',
  nameZh: '办公工具',
  description: 'Document creation, spreadsheets, and presentations',
  descriptionZh: '文档创建、电子表格和演示文稿',
  icon: 'FileText',
  category: 'office',
  // 暂无内置执行器：工具描述已在 toolDefinitions.ts 定义，但 toolExecutors.ts 未实现
  tools: [],
  reservedTools: [
    'doc_write',
    'spreadsheet',
    'presentation',
    'email_send',
  ],
  dependencies: ['code'],
}

// ============================================
// ToolPack 注册表
// ============================================

class ToolPackRegistryClass {
  private packs = new Map<string, ToolPack>()

  register(pack: ToolPack): void {
    this.packs.set(pack.id, pack)
  }

  unregister(packId: string): boolean {
    return this.packs.delete(packId)
  }

  get(packId: string): ToolPack | undefined {
    return this.packs.get(packId)
  }

  getAll(): ToolPack[] {
    return Array.from(this.packs.values())
  }

  getByCategory(category: ToolPackCategory): ToolPack[] {
    return this.getAll().filter(p => p.category === category)
  }

  /**
   * 根据场景需要的工具包列表，解析出完整的工具名列表
   * 自动处理依赖关系
   *
   * 注意：reservedTools（预留工具，尚无执行器）不会出现在结果中，
   * 详见 ToolPack.reservedTools。
   */
  resolveTools(packIds: string[], includeOptional = false): string[] {
    const resolvedPacks = this.resolveDependencies(packIds)
    const tools = new Set<string>()

    for (const packId of resolvedPacks) {
      const pack = this.packs.get(packId)
      if (!pack) continue

      for (const tool of pack.tools) {
        tools.add(tool)
      }

      if (includeOptional && pack.optionalTools) {
        for (const tool of pack.optionalTools) {
          tools.add(tool)
        }
      }
    }

    return Array.from(tools)
  }

  /**
   * 解析出指定工具包（含依赖）的预留工具名
   * 仅用于审计 / 文档生成 / 场景校验，不参与运行时工具暴露
   */
  resolveReservedTools(packIds: string[]): string[] {
    const resolvedPacks = this.resolveDependencies(packIds)
    const tools = new Set<string>()

    for (const packId of resolvedPacks) {
      const pack = this.packs.get(packId)
      if (!pack) continue

      for (const tool of pack.reservedTools || []) {
        tools.add(tool)
      }
    }

    return Array.from(tools)
  }

  /**
   * 解析工具包依赖，返回包含依赖的完整列表
   *
   * 未注册的 packId 会被跳过并输出告警。需要在加载/构建期提前拿到
   * 完整的非法 id 列表时，用 findUnknownPacks()。
   */
  resolveDependencies(packIds: string[]): string[] {
    const resolved = new Set<string>()
    const queue = [...packIds]
    const unknown = new Set<string>()

    while (queue.length > 0) {
      const packId = queue.shift()!
      if (resolved.has(packId)) continue

      const pack = this.packs.get(packId)
      if (!pack) {
        unknown.add(packId)
        continue
      }

      resolved.add(packId)

      if (pack.dependencies) {
        for (const dep of pack.dependencies) {
          if (!resolved.has(dep)) {
            queue.push(dep)
          }
        }
      }
    }

    if (unknown.size > 0) {
      // 静默跳过会让场景「声明了工具包却拿不到工具」，这里显式暴露出来
      console.warn(
        `[ToolPackRegistry] Unknown tool pack id(s) ignored: ${Array.from(unknown).join(', ')}. ` +
        `Registered packs: ${Array.from(this.packs.keys()).join(', ')}`
      )
    }

    return Array.from(resolved)
  }

  /** 返回 packIds 中所有未注册的工具包 id（供场景校验 / 测试使用） */
  findUnknownPacks(packIds: string[]): string[] {
    return packIds.filter(id => !this.packs.has(id))
  }

  has(packId: string): boolean {
    return this.packs.has(packId)
  }
}

export const toolPackRegistry = new ToolPackRegistryClass()

const EDUCATION_TOOL_PACK: ToolPack = {
  id: 'education',
  name: 'Education Tools',
  nameZh: '教育工具',
  description: 'Subject management, topic explanation, quiz generation, study planning, progress tracking, flashcards, and mistake book',
  descriptionZh: '学科管理、知识点讲解、测验生成、学习计划、进度追踪、知识卡片和错题本',
  icon: 'GraduationCap',
  category: 'custom',
  tools: [
    'subject_manage',
    'topic_manage',
    'quiz_manage',
    'study_plan_manage',
    'progress_manage',
    'flashcard_manage',
    'mistake_manage',
    'topic_explain',
    'practice_problems',
    'subject_dashboard',
    'learning_suggest',
  ],
  dependencies: ['code'],
}

const STORE_DIAGNOSIS_TOOL_PACK: ToolPack = {
  id: 'store-diagnosis',
  name: 'Store Diagnosis Tools',
  nameZh: '门店诊断工具',
  description: 'Store management, diagnosis analysis, report generation, and optimization planning',
  descriptionZh: '门店管理、诊断分析、报告生成和优化规划',
  icon: 'Stethoscope',
  category: 'custom',
  tools: [
    'store_manage',
    'store_diagnose',
    'report_generate',
    'optimization_plan',
    'benchmark_query',
  ],
  dependencies: ['code'],
}

// ============================================
// 注册内置工具包
// ============================================

toolPackRegistry.register(CODE_TOOL_PACK)
toolPackRegistry.register(DATA_TOOL_PACK)
toolPackRegistry.register(WEB_TOOL_PACK)
toolPackRegistry.register(MEDIA_TOOL_PACK)
toolPackRegistry.register(OFFICE_TOOL_PACK)
toolPackRegistry.register(EDUCATION_TOOL_PACK)
toolPackRegistry.register(STORE_DIAGNOSIS_TOOL_PACK)
