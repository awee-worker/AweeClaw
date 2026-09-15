/**
 * 场景配置可选值清单（scenarioOptionCatalog）
 *
 * 集中管理 scenario.json 中需要"选择"而非"自由输入"的字段可选值：
 * - 图标（icon）：客户端 LUCIDE_ICON_MAP 支持的图标
 * - 分类（category）：SCENARIO_CATEGORIES
 * - 权限（permissions）：ScenarioPermission 联合类型
 * - 内置工具（capabilities.builtinTools）：BUILTIN_TOOLS
 *
 * 数据源同步自：
 * - src/renderer/components/foundation/IconMap.ts (LUCIDE_ICON_MAP)
 * - src/scenario-system/sdk/index.ts (SCENARIO_CATEGORIES / BUILTIN_TOOLS)
 * - src/shared/protocols/scenario-arch.ts (ScenarioPermission)
 *
 * 此处独立维护一份是为了避免 scenario-builder 场景模块跨层引用 renderer/main 内部模块。
 * 新增可选值时需同步更新此处与源定义。
 */

/** 场景图标可选值（与 LUCIDE_ICON_MAP 键保持一致） */
export const SCENARIO_ICON_OPTIONS: string[] = [
  // 通用
  'Sparkles', 'Package', 'Box', 'Container', 'Layers', 'Layout', 'LayoutDashboard',
  'Grid', 'FolderTree', 'FolderKanban', 'Files', 'FileText', 'BookOpen', 'ClipboardList',
  // 开发
  'Code2', 'Terminal', 'GitBranch', 'GitMerge', 'GitPullRequest', 'Workflow',
  'Bug', 'Beaker', 'TestTube', 'Rocket', 'Command', 'Plug',
  // 数据
  'Database', 'BarChart3', 'PieChart', 'TrendingUp', 'Activity', 'Calculator',
  // AI / 智能
  'Brain', 'Cpu', 'Lightbulb', 'Zap',
  // 通信
  'MessageSquare', 'Mail', 'Send', 'Inbox', 'Bell', 'AtSign', 'Hash',
  // 媒体
  'Image', 'Music', 'Video', 'Camera', 'Mic', 'Volume2',
  // 工具
  'Search', 'Filter', 'Edit', 'PenTool', 'PenLine', 'Eye', 'Play', 'Pause',
  'SkipForward', 'RefreshCw', 'Download', 'Upload', 'Copy', 'Trash2',
  // 安全
  'Shield', 'ShieldCheck', 'Key', 'Lock',
  // 网络 / 云
  'Globe', 'Cloud', 'Network', 'Server', 'Wifi', 'Bluetooth',
  // 设备
  'Monitor', 'Smartphone', 'HardDrive', 'Battery', 'Clock',
  // 业务
  'Briefcase', 'Building2', 'Store', 'ShoppingCart', 'Wallet', 'CreditCard',
  'Users', 'UserCircle', 'Star', 'Heart', 'Bookmark', 'Tag',
  // 专业
  'Stethoscope', 'GraduationCap', 'FlaskConical', 'Palette', 'Scale', 'Map',
  'Calendar', 'StickyNote', 'Lightbulb',
]

/** 场景图标常用推荐（场景 manifest 中高频使用的图标，置顶便于快速选择） */
export const SCENARIO_ICON_RECOMMENDED: string[] = [
  'Sparkles', 'Package', 'Code2', 'Brain', 'Zap', 'Lightbulb',
  'Rocket', 'Wrench', 'MessageSquare', 'BookOpen', 'Globe', 'Database',
]

/** 场景分类可选值（与 SCENARIO_CATEGORIES 保持一致） */
export interface ScenarioCategoryOption {
  value: string
  labelKey: string
}

export const SCENARIO_CATEGORY_OPTIONS: ScenarioCategoryOption[] = [
  { value: 'development', labelKey: 'builder.config.category.development' },
  { value: 'data', labelKey: 'builder.config.category.data' },
  { value: 'creative', labelKey: 'builder.config.category.creative' },
  { value: 'productivity', labelKey: 'builder.config.category.productivity' },
  { value: 'education', labelKey: 'builder.config.category.education' },
  { value: 'automation', labelKey: 'builder.config.category.automation' },
  { value: 'research', labelKey: 'builder.config.category.research' },
  { value: 'communication', labelKey: 'builder.config.category.communication' },
  { value: 'entertainment', labelKey: 'builder.config.category.entertainment' },
  { value: 'business', labelKey: 'builder.config.category.business' },
  { value: 'health', labelKey: 'builder.config.category.health' },
  { value: 'finance', labelKey: 'builder.config.category.finance' },
  { value: 'legal', labelKey: 'builder.config.category.legal' },
  { value: 'marketing', labelKey: 'builder.config.category.marketing' },
  { value: 'energy', labelKey: 'builder.config.category.energy' },
  { value: 'custom', labelKey: 'builder.config.category.custom' },
]

/** 权限可选值（与 ScenarioPermission 联合类型保持一致） */
export interface ScenarioPermissionOption {
  value: string
  labelKey: string
  descKey: string
  group: 'filesystem' | 'database' | 'network' | 'system' | 'interaction'
}

export const SCENARIO_PERMISSION_OPTIONS: ScenarioPermissionOption[] = [
  // 文件系统
  { value: 'filesystem:read', labelKey: 'builder.config.permission.filesystem.read', descKey: 'builder.config.permission.filesystem.read.desc', group: 'filesystem' },
  { value: 'filesystem:write', labelKey: 'builder.config.permission.filesystem.write', descKey: 'builder.config.permission.filesystem.write.desc', group: 'filesystem' },
  // 数据库
  { value: 'database:connect', labelKey: 'builder.config.permission.database.connect', descKey: 'builder.config.permission.database.connect.desc', group: 'database' },
  { value: 'database:query', labelKey: 'builder.config.permission.database.query', descKey: 'builder.config.permission.database.query.desc', group: 'database' },
  // 网络
  { value: 'network:request', labelKey: 'builder.config.permission.network.request', descKey: 'builder.config.permission.network.request.desc', group: 'network' },
  // 系统
  { value: 'terminal:execute', labelKey: 'builder.config.permission.terminal.execute', descKey: 'builder.config.permission.terminal.execute.desc', group: 'system' },
  { value: 'system:info', labelKey: 'builder.config.permission.system.info', descKey: 'builder.config.permission.system.info.desc', group: 'system' },
  { value: 'mcp:call', labelKey: 'builder.config.permission.mcp.call', descKey: 'builder.config.permission.mcp.call.desc', group: 'system' },
  // 交互
  { value: 'clipboard:read', labelKey: 'builder.config.permission.clipboard.read', descKey: 'builder.config.permission.clipboard.read.desc', group: 'interaction' },
  { value: 'clipboard:write', labelKey: 'builder.config.permission.clipboard.write', descKey: 'builder.config.permission.clipboard.write.desc', group: 'interaction' },
  { value: 'notification:send', labelKey: 'builder.config.permission.notification.send', descKey: 'builder.config.permission.notification.send.desc', group: 'interaction' },
]

/** 内置工具可选值（与 BUILTIN_TOOLS 保持一致） */
export interface BuiltinToolOption {
  value: string
  labelKey: string
  descKey: string
  group: 'file' | 'code' | 'exec' | 'web' | 'data' | 'interaction'
  /**
   * 预留工具：工具描述已在 toolDefinitions.ts 定义，但 toolExecutors.ts 尚未实现执行器。
   *
   * 此类工具不会进入场景运行时工具集——BuiltinToolRegistry.isAvailable() 会通过
   * toolRegistry.has() 二次校验并返回 false，即使用户勾选，场景也静默拿不到该工具。
   * 为避免「勾选后静默失效」，UI 将其标记为「未实现」并禁止勾选。
   */
  reserved?: boolean
}

export const BUILTIN_TOOL_OPTIONS: BuiltinToolOption[] = [
  // 文件操作
  { value: 'read_file', labelKey: 'builder.config.tool.read_file', descKey: 'builder.config.tool.read_file.desc', group: 'file' },
  { value: 'write_file', labelKey: 'builder.config.tool.write_file', descKey: 'builder.config.tool.write_file.desc', group: 'file' },
  { value: 'list_directory', labelKey: 'builder.config.tool.list_directory', descKey: 'builder.config.tool.list_directory.desc', group: 'file' },
  { value: 'search_files', labelKey: 'builder.config.tool.search_files', descKey: 'builder.config.tool.search_files.desc', group: 'file' },
  { value: 'edit_file', labelKey: 'builder.config.tool.edit_file', descKey: 'builder.config.tool.edit_file.desc', group: 'file' },
  { value: 'create_file_or_folder', labelKey: 'builder.config.tool.create_file_or_folder', descKey: 'builder.config.tool.create_file_or_folder.desc', group: 'file' },
  { value: 'delete_file_or_folder', labelKey: 'builder.config.tool.delete_file_or_folder', descKey: 'builder.config.tool.delete_file_or_folder.desc', group: 'file' },
  // 代码搜索
  { value: 'codebase_search', labelKey: 'builder.config.tool.codebase_search', descKey: 'builder.config.tool.codebase_search.desc', group: 'code' },
  { value: 'get_lint_errors', labelKey: 'builder.config.tool.get_lint_errors', descKey: 'builder.config.tool.get_lint_errors.desc', group: 'code' },
  { value: 'find_references', labelKey: 'builder.config.tool.find_references', descKey: 'builder.config.tool.find_references.desc', group: 'code' },
  { value: 'go_to_definition', labelKey: 'builder.config.tool.go_to_definition', descKey: 'builder.config.tool.go_to_definition.desc', group: 'code' },
  { value: 'get_hover_info', labelKey: 'builder.config.tool.get_hover_info', descKey: 'builder.config.tool.get_hover_info.desc', group: 'code' },
  { value: 'get_document_symbols', labelKey: 'builder.config.tool.get_document_symbols', descKey: 'builder.config.tool.get_document_symbols.desc', group: 'code' },
  // 执行
  { value: 'run_command', labelKey: 'builder.config.tool.run_command', descKey: 'builder.config.tool.run_command.desc', group: 'exec' },
  { value: 'read_terminal_output', labelKey: 'builder.config.tool.read_terminal_output', descKey: 'builder.config.tool.read_terminal_output.desc', group: 'exec' },
  { value: 'send_terminal_input', labelKey: 'builder.config.tool.send_terminal_input', descKey: 'builder.config.tool.send_terminal_input.desc', group: 'exec' },
  { value: 'stop_terminal', labelKey: 'builder.config.tool.stop_terminal', descKey: 'builder.config.tool.stop_terminal.desc', group: 'exec' },
  // 网络
  { value: 'web_search', labelKey: 'builder.config.tool.web_search', descKey: 'builder.config.tool.web_search.desc', group: 'web' },
  { value: 'read_url', labelKey: 'builder.config.tool.read_url', descKey: 'builder.config.tool.read_url.desc', group: 'web' },
  // 数据
  // 预留工具：无内置执行器，UI 标记「未实现」且禁止勾选
  { value: 'sql_query', labelKey: 'builder.config.tool.sql_query', descKey: 'builder.config.tool.sql_query.desc', group: 'data', reserved: true },
  { value: 'data_transform', labelKey: 'builder.config.tool.data_transform', descKey: 'builder.config.tool.data_transform.desc', group: 'data', reserved: true },
  { value: 'chart_generate', labelKey: 'builder.config.tool.chart_generate', descKey: 'builder.config.tool.chart_generate.desc', group: 'data', reserved: true },
  { value: 'csv_analyze', labelKey: 'builder.config.tool.csv_analyze', descKey: 'builder.config.tool.csv_analyze.desc', group: 'data', reserved: true },
  { value: 'statistical_test', labelKey: 'builder.config.tool.statistical_test', descKey: 'builder.config.tool.statistical_test.desc', group: 'data', reserved: true },
  { value: 'knowledge_search', labelKey: 'builder.config.tool.knowledge_search', descKey: 'builder.config.tool.knowledge_search.desc', group: 'data' },
  // 交互
  { value: 'ask_user', labelKey: 'builder.config.tool.ask_user', descKey: 'builder.config.tool.ask_user.desc', group: 'interaction' },
  { value: 'todo_write', labelKey: 'builder.config.tool.todo_write', descKey: 'builder.config.tool.todo_write.desc', group: 'interaction' },
  { value: 'remember', labelKey: 'builder.config.tool.remember', descKey: 'builder.config.tool.remember.desc', group: 'interaction' },
  { value: 'companion_control', labelKey: 'builder.config.tool.companion_control', descKey: 'builder.config.tool.companion_control.desc', group: 'interaction' },
]
