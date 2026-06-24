/**
 * 命令面板命令注册中心
 *
 * 设计理念：
 * - 单一职责：仅负责命令定义和注册，不涉及 UI
 * - 可扩展：支持动态注册命令
 * - 可分类：按类别组织命令
 * - 可搜索：支持模糊搜索
 * - 历史记录：记录最近使用的命令
 */

import {
  Search,
  FolderOpen,
  Settings,
  Terminal,
  MessageSquare,
  History,
  Trash2,
  RefreshCw,
  Save,
  Zap,
  Keyboard,
  Sparkles,
  Plus,
  FolderPlus,
  PanelRight,
  type LucideIcon,
} from 'lucide-react'

/** 命令定义 */
export interface CommandDefinition {
  id: string
  label: string
  description?: string
  icon: LucideIcon
  category: string
  shortcut?: string
  /** 是否启用（动态判断） */
  enabled?: (ctx: CommandContext) => boolean
}

/** 命令实例（带 action） */
export interface Command extends CommandDefinition {
  action: () => void
}

/** 命令上下文：提供执行命令所需的依赖 */
export interface CommandContext {
  /** 当前工作区路径 */
  workspacePath: string | null
  /** 当前活动文件路径 */
  activeFilePath: string | null
  /** 终端是否可见 */
  terminalVisible: boolean
  /** AI 面板是否可见 */
  chatVisible: boolean
  /** 设置 AI 输入提示 */
  setInputPrompt: (prompt: string) => void
  /** 设置模式 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setMode: (mode: any) => void
  /** 显示设置页 */
  setShowSettingsPage: (show: boolean) => void
  /** 设置终端可见性 */
  setTerminalVisible: (visible: boolean) => void
  /** 显示快速打开 */
  setShowQuickOpen: (show: boolean) => void
  /** 显示工作流 */
  setShowWorkflow: (show: boolean) => void
  /** 显示关于 */
  setShowAbout: (show: boolean) => void
  /** 设置 AI 面板可见性 */
  setChatVisible: (visible: boolean) => void
  /** 清除消息 */
  clearMessages: () => void
  /** 清除检查点 */
  clearCheckpoints: () => void
  /** 显示键盘快捷键 */
  onShowKeyboardShortcuts: () => void
  /** 关闭面板 */
  onClose: () => void
}

/** 静态命令定义（不含 action） */
const STATIC_COMMANDS: CommandDefinition[] = [
  // AI Actions
  {
    id: 'ai-chat',
    label: 'Ask AI...',
    description: 'Start a new chat conversation',
    icon: Sparkles,
    category: 'AI',
  },
  {
    id: 'ai-explain',
    label: 'Explain Current File',
    description: 'Ask AI to explain the active file',
    icon: MessageSquare,
    category: 'AI Helper',
    enabled: (ctx) => !!ctx.activeFilePath,
  },
  {
    id: 'ai-refactor',
    label: 'Refactor File',
    description: 'Ask AI to suggest refactoring improvements',
    icon: Zap,
    category: 'AI Helper',
    enabled: (ctx) => !!ctx.activeFilePath,
  },
  {
    id: 'ai-fix',
    label: 'Fix Bugs',
    description: 'Ask AI to find and fix bugs in current file',
    icon: Zap,
    category: 'AI Helper',
    enabled: (ctx) => !!ctx.activeFilePath,
  },
  // File Operations
  {
    id: 'open-folder',
    label: 'Open Folder',
    description: 'Open a workspace folder',
    icon: FolderOpen,
    category: 'File',
  },
  {
    id: 'new-window',
    label: 'New Window',
    description: 'Open a new application window',
    icon: Plus,
    category: 'Window',
  },
  {
    id: 'add-folder',
    label: 'Add Folder to Workspace...',
    description: 'Add a new root folder to the current workspace',
    icon: FolderPlus,
    category: 'Workspace',
  },
  {
    id: 'save-workspace',
    label: 'Save Workspace As...',
    description: 'Save the current multi-root workspace configuration',
    icon: Save,
    category: 'Workspace',
  },
  {
    id: 'save-file',
    label: 'Save File',
    description: 'Save the current file',
    icon: Save,
    category: 'File',
  },
  {
    id: 'refresh-files',
    label: 'Refresh File Explorer',
    description: 'Reload the file tree',
    icon: RefreshCw,
    category: 'File',
  },
  // View & Settings
  {
    id: 'quick-open',
    label: 'Go to File...',
    description: 'Search and open files by name',
    icon: Search,
    category: 'File',
  },
  {
    id: 'toggle-terminal',
    label: 'Toggle Terminal',
    description: 'Toggle the terminal panel',
    icon: Terminal,
    category: 'View',
  },
  {
    id: 'toggle-ai-panel',
    label: 'Toggle AI Panel',
    description: 'Toggle the AI assistant panel',
    icon: PanelRight,
    category: 'View',
  },
  {
    id: 'open-workflow',
    label: 'Open Workflow',
    description: 'Multi-agent collaboration workflow',
    icon: Sparkles,
    category: 'AI Tools',
  },
  {
    id: 'settings',
    label: 'Open Settings',
    description: 'Configure API keys and preferences',
    icon: Settings,
    category: 'Preferences',
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    description: 'View all keyboard shortcuts',
    icon: Keyboard,
    category: 'Help',
  },
  {
    id: 'about',
    label: 'About AweeClaw',
    description: 'View application information',
    icon: MessageSquare,
    category: 'Help',
  },
  {
    id: 'clear-chat',
    label: 'Clear Chat History',
    description: 'Remove all messages from the chat',
    icon: Trash2,
    category: 'AI Tools',
  },
  {
    id: 'clear-checkpoints',
    label: 'Clear All Checkpoints',
    description: 'Remove all saved checkpoints',
    icon: History,
    category: 'AI Tools',
  },
]

/** 动态命令定义（需要根据上下文动态生成 label） */
function buildDynamicCommands(ctx: CommandContext): CommandDefinition[] {
  return STATIC_COMMANDS.map((cmd) => {
    const dynamic: CommandDefinition = { ...cmd }

    switch (cmd.id) {
      case 'toggle-terminal':
        dynamic.label = ctx.terminalVisible ? 'Hide Terminal' : 'Show Terminal'
        break
      case 'toggle-ai-panel':
        dynamic.label = ctx.chatVisible ? 'Hide AI Panel' : 'Show AI Panel'
        break
    }

    return dynamic
  })
}

/**
 * 构建命令列表（带 action）
 *
 * @param ctx 命令上下文
 * @param shortcuts 快捷键映射
 * @returns 完整命令列表
 */
export function buildCommands(
  ctx: CommandContext,
  shortcuts: Record<string, string>,
): Command[] {
  const definitions = buildDynamicCommands(ctx)

  return definitions.map((def) => {
    const command: Command = {
      ...def,
      shortcut: shortcuts[def.id] || def.shortcut,
      action: () => executeCommand(def.id, ctx),
    }
    return command
  })
}

/**
 * 执行命令
 *
 * @param id 命令 ID
 * @param ctx 命令上下文
 */
function executeCommand(id: string, ctx: CommandContext): void {
  switch (id) {
    case 'ai-chat':
      ctx.setChatVisible(true)
      ctx.setMode('chat')
      break
    case 'ai-explain':
      if (ctx.activeFilePath) {
        ctx.setChatVisible(true)
        ctx.setMode('chat')
        ctx.setInputPrompt(`Explain the file ${ctx.activeFilePath} in detail.`)
      }
      break
    case 'ai-refactor':
      if (ctx.activeFilePath) {
        ctx.setChatVisible(true)
        ctx.setMode('chat')
        ctx.setInputPrompt(
          `Analyze ${ctx.activeFilePath} and suggest refactoring improvements for readability and performance.`,
        )
      }
      break
    case 'ai-fix':
      if (ctx.activeFilePath) {
        ctx.setChatVisible(true)
        ctx.setMode('chat')
        ctx.setInputPrompt(`Find potential bugs in ${ctx.activeFilePath} and provide fixes.`)
      }
      break
    case 'toggle-terminal':
      ctx.setTerminalVisible(!ctx.terminalVisible)
      break
    case 'toggle-ai-panel':
      ctx.setChatVisible(!ctx.chatVisible)
      break
    case 'quick-open':
      ctx.setShowQuickOpen(true)
      break
    case 'open-workflow':
      ctx.setShowWorkflow(true)
      break
    case 'settings':
      ctx.setShowSettingsPage(true)
      break
    case 'keyboard-shortcuts':
      ctx.onShowKeyboardShortcuts()
      break
    case 'about':
      ctx.setShowAbout(true)
      break
    case 'clear-chat':
      ctx.clearMessages()
      break
    case 'clear-checkpoints':
      ctx.clearCheckpoints()
      break
    // 以下命令需要外部 API，由调用方处理
    case 'open-folder':
    case 'new-window':
    case 'add-folder':
    case 'save-workspace':
    case 'save-file':
    case 'refresh-files':
      // 这些命令的 action 由 CommandPalette 组件注入
      break
  }
}

/**
 * 模糊搜索命令
 *
 * @param commands 命令列表
 * @param query 搜索查询
 * @returns 过滤后的命令列表
 */
export function fuzzySearchCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands

  const q = query.toLowerCase()
  const tokens = q.split(/\s+/).filter(Boolean)

  return commands.filter((cmd) => {
    const searchText = `${cmd.label} ${cmd.description || ''} ${cmd.category}`.toLowerCase()
    // 所有 token 都必须匹配
    return tokens.every((token) => searchText.includes(token))
  })
}

/**
 * 按类别分组命令
 *
 * @param commands 命令列表
 * @returns 分组后的命令
 */
export function groupCommandsByCategory(
  commands: Command[],
): Map<string, Command[]> {
  const groups = new Map<string, Command[]>()

  for (const cmd of commands) {
    if (!groups.has(cmd.category)) {
      groups.set(cmd.category, [])
    }
    groups.get(cmd.category)!.push(cmd)
  }

  return groups
}
