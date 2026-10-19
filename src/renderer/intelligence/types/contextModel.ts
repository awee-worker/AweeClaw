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

/**
 * 二级项的选择结果（如「生成方式：逐页生成」）
 *
 * 同一个技能/插件往往有多个可同时生效的二级项（生成方式、模板风格、输出比例），
 * 一次选择只覆盖它自己那一项，不能把别的项顶掉，因此按 key 分开记录。
 */
export interface SubSelectionEntry {
  /** 二级项标识：取自 subSkills[].label，同一项重复选择时覆盖旧值 */
  key: string
  /** 展示用标签，如「生成方式：逐页生成」 */
  label: string
  /**
   * 该项要注入 AI 的说明正文（静默项的模板渲染结果）。
   *
   * 与 label 分开：label 给人看，note 给模型看，两者都不允许被其他二级项覆盖。
   */
  note?: string
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
   *
   * 该字段是由 subSelections 各条 label 拼成的展示串，仅作画面与旧数据兼容用；
   * 事实来源是 subSelections，写入一律走它。
   */
  subSelection?: string
  /** 全部二级项的选择结果：不同项并存、同一项覆盖 */
  subSelections?: SubSelectionEntry[]
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
   *
   * 同样是由 subSelections 拼出的展示串，事实来源是 subSelections。
   */
  subSelection?: string
  /** 全部二级项的选择结果：生成方式、模板风格这类并列项必须同时保留 */
  subSelections?: SubSelectionEntry[]
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
