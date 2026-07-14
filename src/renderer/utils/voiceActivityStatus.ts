/**
 * 语音对话活动状态工具
 *
 * 将工具名 + 参数转换为人类可读的活动描述，
 * 让用户在语音对话时知道 AI 正在做什么。
 */

/** 单个工具活动状态 */
export interface ActivityStatus {
  /** 人性化动作描述（如"正在创建文件"） */
  action: string
  /** 操作对象摘要（如"/Users/liwei/story.txt"或"ls -la"） */
  target?: string
  /** 步骤序号（从1开始） */
  step: number
  /** 总步骤数（估算） */
  totalSteps: number
  /** 工具名称（原始，用于图标映射） */
  toolName: string
  /** 开始时间戳 */
  startTime: number
}

/**
 * 工具名称 → 人性化动作描述
 */
const TOOL_ACTIONS: Record<string, string> = {
  // 写操作
  write_file: '创建文件',
  edit_file: '编辑文件',
  replace_file_content: '修改文件',
  create_file_or_folder: '创建文件',
  delete_file_or_folder: '删除文件',
  run_command: '执行命令',
  // 读操作
  read_file: '读取文件',
  read_multiple_files: '读取文件',
  list_directory: '查看目录',
  get_dir_tree: '查看目录结构',
  get_file_info: '获取文件信息',
  // 搜索
  search_files: '搜索文件',
  grep_search: '搜索内容',
  codebase_search: '搜索代码',
  find_references: '查找引用',
  go_to_definition: '查找定义',
  get_hover_info: '获取信息',
  get_document_symbols: '分析文档',
}

/** 工具名 → 对应的图标名（供 UI 使用） */
export type ActivityIcon = 'write' | 'read' | 'search' | 'command' | 'delete' | 'other'

const TOOL_ICONS: Record<string, ActivityIcon> = {
  write_file: 'write',
  edit_file: 'write',
  replace_file_content: 'write',
  create_file_or_folder: 'write',
  delete_file_or_folder: 'delete',
  run_command: 'command',
  read_file: 'read',
  read_multiple_files: 'read',
  list_directory: 'read',
  get_dir_tree: 'read',
  get_file_info: 'read',
  search_files: 'search',
  grep_search: 'search',
  codebase_search: 'search',
  find_references: 'search',
  go_to_definition: 'search',
  get_hover_info: 'read',
  get_document_symbols: 'read',
}

/**
 * 根据工具名获取图标类型
 */
export function getActivityIcon(toolName: string): ActivityIcon {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName]
  const lower = toolName.toLowerCase()
  if (lower.includes('write') || lower.includes('create') || lower.includes('edit')) return 'write'
  if (lower.includes('delete') || lower.includes('remove')) return 'delete'
  if (lower.includes('run') || lower.includes('execute') || lower.includes('command')) return 'command'
  if (lower.includes('read') || lower.includes('get') || lower.includes('list')) return 'read'
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) return 'search'
  return 'other'
}

/**
 * 从工具参数中提取操作对象摘要
 *
 * 不同工具的参数结构不同，提取有意义的展示信息：
 * - write_file: path + content
 * - read_file: path
 * - run_command: command
 * - search_files: query
 * - list_directory: path
 */
function extractTargetFromArgs(toolName: string, args: Record<string, unknown>): string | undefined {
  const path = args.path as string | undefined
  const command = args.command as string | undefined
  const query = args.query as string | undefined
  const regex = args.regex as string | undefined
  const dirPath = args.dirPath as string | undefined

  switch (toolName) {
    case 'write_file':
    case 'edit_file':
    case 'replace_file_content':
      return path ? shortenPath(path) : undefined

    case 'read_file':
    case 'get_file_info':
      return path ? shortenPath(path) : undefined

    case 'list_directory':
    case 'get_dir_tree':
      return path || dirPath ? shortenPath((path || dirPath) as string) : undefined

    case 'run_command':
      return command ? truncate(command, 60) : undefined

    case 'search_files':
      return query ? `"${truncate(query, 40)}"` : undefined

    case 'grep_search':
      return regex ? `"${truncate(regex, 40)}"` : undefined

    case 'codebase_search':
      return query ? `"${truncate(query, 40)}"` : undefined

    case 'read_multiple_files': {
      const paths = args.paths as string[] | undefined
      if (paths && paths.length > 0) {
        return paths.length === 1 ? shortenPath(paths[0]) : `${paths.length} 个文件`
      }
      return undefined
    }

    default: {
      // MCP 工具或其他工具：尝试通用字段
      if (path) return shortenPath(path)
      if (command) return truncate(command, 60)
      if (query) return `"${truncate(query, 40)}"`
      return undefined
    }
  }
}

/**
 * 根据工具名+参数生成活动状态
 */
export function createActivityStatus(
  toolName: string,
  args: Record<string, unknown>,
  step: number,
  totalSteps: number,
): ActivityStatus {
  const action = TOOL_ACTIONS[toolName] || guessActionFromName(toolName)
  const target = extractTargetFromArgs(toolName, args)

  return {
    action,
    target,
    step,
    totalSteps,
    toolName,
    startTime: Date.now(),
  }
}

/**
 * 格式化已执行时间
 */
export function formatElapsedTime(startTime: number, now: number): string {
  const seconds = Math.floor((now - startTime) / 1000)
  if (seconds < 1) return '刚开始'
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes}分${remainSeconds}秒`
}

// ==================== 内部工具函数 ====================

/** 从工具名模糊猜测动作 */
function guessActionFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('write') || lower.includes('create')) return '创建文件'
  if (lower.includes('edit') || lower.includes('update')) return '编辑文件'
  if (lower.includes('read') || lower.includes('get')) return '读取信息'
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) return '搜索'
  if (lower.includes('run') || lower.includes('execute') || lower.includes('command')) return '执行命令'
  if (lower.includes('delete') || lower.includes('remove')) return '删除文件'
  if (lower.includes('list') || lower.includes('tree')) return '查看目录'
  return '处理中'
}

/** 缩短路径，只保留最后两级目录+文件名 */
function shortenPath(path: string): string {
  if (!path) return ''
  const parts = path.split('/')
  if (parts.length <= 3) return path
  return '.../' + parts.slice(-2).join('/')
}

/** 截断字符串并加省略号 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}
