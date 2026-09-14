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
  tools: string[]
  optionalTools?: string[]
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
  tools: [
    'read_file',
    'list_directory',
    'get_dir_tree',
    'search_files',
    'read_multiple_files',
    'edit_file',
    'write_file',
    'replace_file_content',
    'create_file_or_folder',
    'delete_file_or_folder',
    'run_command',
    'get_lint_errors',
    'find_references',
    'go_to_definition',
    'get_hover_info',
    'get_document_symbols',
    'codebase_search',
    'web_search',
    'read_url',
    'remember',
    'knowledge_search',
    'apply_skill',
    'todo_write',
    'ask_user',
    // 桌面伴侣控制（VRM 角色动作 / 表情 / 说话）
    'companion_control',
  ],
  optionalTools: [
    'uiux_search',
    'uiux_recommend',
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
  tools: [
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
  tools: [
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
  tools: [
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
  tools: [
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
   * 解析工具包依赖，返回包含依赖的完整列表
   */
  resolveDependencies(packIds: string[]): string[] {
    const resolved = new Set<string>()
    const queue = [...packIds]

    while (queue.length > 0) {
      const packId = queue.shift()!
      if (resolved.has(packId)) continue

      const pack = this.packs.get(packId)
      if (!pack) continue

      resolved.add(packId)

      if (pack.dependencies) {
        for (const dep of pack.dependencies) {
          if (!resolved.has(dep)) {
            queue.push(dep)
          }
        }
      }
    }

    return Array.from(resolved)
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
