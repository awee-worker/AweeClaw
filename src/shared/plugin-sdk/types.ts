/**
 * Plugin SDK - 插件开发核心接口定义
 *
 * 核心设计原则：
 * - Manifest-first：插件通过 manifest 声明能力，核心无需加载运行时即可发现
 * - 懒加载：插件运行时仅在需要时加载，减少启动开销
 * - 隔离性：每个插件有独立的生命周期和错误边界
 * - 可扩展：Channel / Provider / Tool / Hook 均可通过插件注册
 *
 * @module plugin-sdk
 */

// ============================================
// 插件 Manifest（声明式元数据）
// ============================================

/** 插件类型 */
export type PluginType = 'channel' | 'provider' | 'tool' | 'hook' | 'memory' | 'composite'

/** 插件生命周期 */
export type PluginLifecycle = 'singleton' | 'per-account' | 'per-session'

/** 插件 Manifest - 插件的声明式元数据，无需加载运行时即可读取 */
export interface PluginManifest {
  /** 插件唯一标识，如 "channel-feishu"、"provider-openai" */
  id: string
  /** 显示名称 */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 插件类型 */
  type: PluginType | PluginType[]
  /** 版本号（semver） */
  version: string
  /** 入口模块路径（相对于插件根目录） */
  main: string
  /** 图标（lucide 图标名或 URL） */
  icon?: string
  /** 生命周期 */
  lifecycle?: PluginLifecycle
  /** 依赖的其他插件 ID */
  dependencies?: string[]
  /** 插件能力声明 */
  capabilities?: PluginCapabilities
  /** 配置 Schema（用于 UI 渲染配置表单） */
  configSchema?: PluginConfigSchema
  /** 所需权限 */
  permissions?: PluginPermission[]
  /** 支持的平台 */
  platforms?: PluginPlatform[]
  /** 是否为内置插件 */
  builtin?: boolean
  /** 作者 */
  author?: string
  /** 主页 URL */
  homepage?: string
}

export type PluginPlatform = 'darwin' | 'win32' | 'linux'

/** 插件能力声明 */
export interface PluginCapabilities {
  /** Channel 插件能力 */
  channel?: {
    /** 支持的连接模式 */
    connectionModes: Array<'websocket' | 'webhook' | 'polling'>
    /** 支持的聊天类型 */
    chatTypes: Array<'direct' | 'group' | 'channel'>
    /** 是否支持媒体消息 */
    media: boolean
    /** 是否支持消息反应 */
    reactions: boolean
    /** 是否支持话题/线程 */
    threads: boolean
    /** 是否支持消息编辑 */
    edit: boolean
    /** 是否支持流式回复 */
    streaming: boolean
    /** 是否支持语音 */
    voice: boolean
    /** 是否支持文件传输 */
    files: boolean
  }
  /** Provider 插件能力 */
  provider?: {
    /** 支持的协议 */
    protocols: string[]
    /** 是否支持流式 */
    streaming: boolean
    /** 是否支持工具调用 */
    toolCalling: boolean
    /** 是否支持 embedding */
    embedding: boolean
    /** 是否支持多模态 */
    multimodal: boolean
  }
  /** Tool 插件能力 */
  tool?: {
    /** 工具并发模式 */
    concurrency: 'parallel-safe' | 'serialized' | 'approval-gated'
    /** 是否需要沙箱执行 */
    sandboxed: boolean
    /** 是否需要审批 */
    requiresApproval: boolean
  }
  /** Hook 插件能力 */
  hook?: {
    /** 支持的钩子事件 */
    events: HookEventName[]
  }
}

/** 配置 Schema 字段定义 */
export interface PluginConfigSchema {
  /** 配置字段列表 */
  fields: PluginConfigField[]
}

export interface PluginConfigField {
  /** 字段键名 */
  key: string
  /** 显示名称 */
  label: string
  /** 中文显示名称 */
  labelZh: string
  /** 描述 */
  description?: string
  /** 中文描述 */
  descriptionZh?: string
  /** 字段类型 */
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect'
  /** 是否必填 */
  required: boolean
  /** 默认值 */
  defaultValue?: unknown
  /** 占位符 */
  placeholder?: string
  /** select/multiselect 选项 */
  options?: Array<{ value: string; label: string; labelZh: string }>
  /** 是否为敏感信息（密码等） */
  secret?: boolean
  /** 校验规则 */
  validation?: {
    min?: number
    max?: number
    pattern?: string
    patternMessage?: string
  }
}

/** 插件权限声明 */
export type PluginPermission =
  | 'network'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'clipboard.read'
  | 'clipboard.write'
  | 'notification'
  | 'system.info'

// ============================================
// 插件运行时接口
// ============================================

/** 插件运行时上下文 - 插件初始化时注入的宿主能力 */
export interface PluginContext {
  /** 插件 ID */
  pluginId: string
  /** 插件数据目录（每个插件独立） */
  dataDir: string
  /** 日志器（按插件 ID 分区） */
  logger: PluginLogger
  /** 获取插件配置 */
  getConfig: () => Record<string, unknown>
  /** 更新插件配置 */
  setConfig: (config: Record<string, unknown>) => Promise<void>
  /** 获取密钥（安全存储） */
  getSecret: (key: string) => Promise<string | undefined>
  /** 设置密钥（安全存储） */
  setSecret: (key: string, value: string) => Promise<void>
  /** 注册 Hook */
  registerHook: (event: HookEventName, handler: HookHandler) => () => void
  /** 发送 IPC 事件到渲染进程 */
  sendToRenderer: (channel: string, ...args: unknown[]) => void
}

/** 插件日志接口 */
export interface PluginLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/** 插件运行时接口 - 所有插件必须实现 */
export interface PluginRuntime {
  /** 插件初始化（在注册后、使用前调用） */
  initialize(ctx: PluginContext): Promise<void>
  /** 插件销毁（在卸载或应用退出时调用） */
  destroy(): Promise<void>
  /** 健康检查 */
  healthCheck?(): Promise<PluginHealthResult>
}

/** 健康检查结果 */
export interface PluginHealthResult {
  healthy: boolean
  message?: string
  details?: Record<string, unknown>
}

// ============================================
// Hook 系统
// ============================================

/** 钩子事件名称 */
export type HookEventName =
  | 'before-agent-start'
  | 'after-agent-reply'
  | 'before-tool-call'
  | 'after-tool-call'
  | 'before-message-send'
  | 'after-message-receive'
  | 'on-session-create'
  | 'on-session-reset'
  | 'on-channel-connect'
  | 'on-channel-disconnect'
  | 'on-channel-error'
  | 'on-config-change'
  | 'on-cron-trigger'

/** 钩子处理器 */
export type HookHandler<TPayload = unknown> = (payload: TPayload) => HookResult | Promise<HookResult>

/** 钩子执行结果 */
export interface HookResult {
  /** 是否继续执行后续钩子和原始操作 */
  proceed: boolean
  /** 修改后的数据（可选，用于 before-* 钩子修改输入） */
  modified?: unknown
  /** 阻止原因（proceed=false 时） */
  reason?: string
}

/** 钩子注册信息 */
export interface HookRegistration {
  id: string
  event: HookEventName
  handler: HookHandler
  pluginId: string
  priority: number
}

// ============================================
// 插件注册表接口
// ============================================

/** 插件注册信息（包含 manifest 和运行时状态） */
export interface PluginRegistration {
  manifest: PluginManifest
  runtime: PluginRuntime | null
  status: PluginStatus
  error?: string
  loadedAt?: number
}

/** 插件状态 */
export type PluginStatus = 'discovered' | 'loaded' | 'initialized' | 'active' | 'error' | 'disabled'

/** 插件注册表接口 */
export interface IPluginRegistry {
  /** 发现所有可用插件（扫描目录 + 读取 manifest） */
  discover(): Promise<PluginManifest[]>
  /** 加载插件运行时 */
  load(pluginId: string): Promise<void>
  /** 初始化插件 */
  initialize(pluginId: string): Promise<void>
  /** 卸载插件 */
  unload(pluginId: string): Promise<void>
  /** 获取插件注册信息 */
  getRegistration(pluginId: string): PluginRegistration | undefined
  /** 获取所有已注册插件 */
  getAllRegistrations(): PluginRegistration[]
  /** 按类型获取插件 */
  getByType(type: PluginType): PluginRegistration[]
  /** 启用插件 */
  enable(pluginId: string): Promise<void>
  /** 禁用插件 */
  disable(pluginId: string): Promise<void>
  /** 注册 Hook */
  registerHook(event: HookEventName, handler: HookHandler, pluginId: string, priority?: number): () => void
  /** 触发 Hook */
  triggerHook(event: HookEventName, payload: unknown): Promise<HookResult[]>
}

// ============================================
// 插件加载器接口
// ============================================

/** 插件加载器 - 负责发现和加载插件 */
export interface IPluginLoader {
  /** 扫描指定目录发现插件 */
  scan(directory: string): Promise<PluginManifest[]>
  /** 加载插件运行时 */
  loadRuntime(manifest: PluginManifest): Promise<PluginRuntime>
  /** 验证 manifest 合法性 */
  validateManifest(manifest: unknown): manifest is PluginManifest
}

// ============================================
// 插件事件
// ============================================

/** 插件系统事件 */
export type PluginSystemEvent =
  | { type: 'plugin:discovered'; pluginId: string }
  | { type: 'plugin:loaded'; pluginId: string }
  | { type: 'plugin:initialized'; pluginId: string }
  | { type: 'plugin:active'; pluginId: string }
  | { type: 'plugin:error'; pluginId: string; error: string }
  | { type: 'plugin:disabled'; pluginId: string }
  | { type: 'plugin:unloaded'; pluginId: string }

/** 插件事件监听器 */
export type PluginSystemEventListener = (event: PluginSystemEvent) => void
