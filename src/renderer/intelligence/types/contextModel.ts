/**
 * 上下文相关类型定义
 */

/** 上下文项类型 */
export type ContextItemType =
  | 'File'
  | 'CodeSelection'
  | 'Folder'
  | 'Codebase'
  | 'Git'
  | 'Terminal'
  | 'Symbols'
  | 'Web'
  | 'Problems'
  | 'Skill'
  | 'Plugin'

export interface FileContext {
  type: 'File'
  uri: string
  /**
   * 静默标记：上传附件自动添加的 File context 设为 true，
   * UI 渲染时跳过（不在消息顶部显示文件名标签），但仍注入给 AI 以提供文件路径。
   */
  silent?: boolean
}

export interface CodeSelectionContext {
  type: 'CodeSelection'
  uri: string
  range: [number, number]
}

export interface FolderContext {
  type: 'Folder'
  uri: string
}

export interface CodebaseContext {
  type: 'Codebase'
  query?: string
}

export interface GitContext {
  type: 'Git'
}

export interface TerminalContext {
  type: 'Terminal'
}

export interface SymbolsContext {
  type: 'Symbols'
}

export interface WebContext {
  type: 'Web'
  query?: string
}

export interface ProblemsContext {
  type: 'Problems'
  uri?: string
}

export interface SkillContext {
  type: 'Skill'
  skillId: string
  name: string
  description?: string
  /** LLM 自动选中（非 @mention） */
  auto?: boolean
}

export interface PluginContext {
  type: 'Plugin'
  /** 插件唯一标识（pluginKey，如 3d-webpage-gen） */
  pluginId: string
  name: string
  description?: string
  /** 插件连接对应的 MCP server id（如 plugin:3d-webpage-gen） */
  mcpServerId?: string
}

/** 上下文项联合类型 */
export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
  | GitContext
  | TerminalContext
  | SymbolsContext
  | WebContext
  | ProblemsContext
  | SkillContext
  | PluginContext
