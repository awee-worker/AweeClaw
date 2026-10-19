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
  /** 界面展示名：中文界面下优先显示技能中文名，缺省回退到 name */
  displayName?: string
  description?: string
  /** LLM 自动选中（非 @mention） */
  auto?: boolean
  /**
   * 二级项的选择结果（如「模板：商务浅色」）。
   *
   * 二级项只在技能栏里可见，一旦发送出去就只剩技能标签，用户无从确认
   * 当时选了什么；这个字段让消息气泡把选择一并展示，并随上下文注入给 AI。
   */
  subSelection?: string
}

export interface PluginContext {
  type: 'Plugin'
  /** 插件唯一标识（pluginKey，如 3d-webpage-gen） */
  pluginId: string
  name: string
  /** 界面展示名：中文界面下优先显示插件中文名，缺省回退到 name */
  displayName?: string
  description?: string
  /** 插件连接对应的 MCP server id（如 plugin:3d-webpage-gen） */
  mcpServerId?: string
  /**
   * 插件侧写回的操作结果（如「当前默认模板：科技深色」）。
   *
   * 由插件调用 host.setContextNote 更新，随上下文注入给 AI，
   * 使 AI 知道用户在插件界面里已经做过的选择，不必再问。
   */
  stateNote?: string
  /**
   * 二级项的选择结果（如「模板：商务浅色」）。
   *
   * 与技能的 subSelection 同义：插件条目在技能栏里同样能展开二级项，
   * 用户点过的选择必须随上下文一起发出去，并在消息气泡里显示出来，
   * 否则消息上只剩一个插件名，用户无从确认当时选了什么。
   */
  subSelection?: string
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
