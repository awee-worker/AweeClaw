/**
 * 场景架构核心接口规范
 *
 * 定义场景模块系统的完整接口体系，包括：
 * - ScenarioManifest: 场景清单，描述场景元数据
 * - ScenarioLifecycle: 场景生命周期钩子
 * - ScenarioModule (增强版): 统一的场景模块接口
 * - ScenarioModuleContext (增强版): 场景上下文，包含数据总线、版本管理等
 * - ScenarioDataBus: 场景间数据交互总线接口
 * - ScenarioVersionInfo: 版本控制信息
 * - ScenarioHealthReport: 健康检查报告
 * - ScenarioDependency: 场景依赖声明
 *
 * 设计原则：
 * - 向后兼容：现有 ScenarioModule 接口继续有效
 * - 最小接口：核心接口只包含必要方法，扩展能力通过可选方法提供
 * - 声明式优先：场景通过声明描述自身能力，框架负责调度
 */

import type { ScenarioPlugin, ScenarioCategory } from './scenario'
import type { ToolDefinition, ToolExecutor } from './index'

// ============================================
// 场景生命周期状态
// ============================================

export type ScenarioLifecycleState =
  | 'unregistered'
  | 'registered'
  | 'activating'
  | 'activated'
  | 'deactivating'
  | 'deactivated'
  | 'error'

// ============================================
// 场景依赖声明
// ============================================

export interface ScenarioDependency {
  id: string
  versionRange?: string
  required?: boolean
}

// ============================================
// 场景清单（Manifest）
// ============================================

export interface ScenarioManifest {
  id: string
  version: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  author: string
  icon: string
  category: ScenarioCategory
  tags: string[]
  minAppVersion?: string
  dependencies?: ScenarioDependency[]
  permissions?: ScenarioPermission[]
  entryPoint: string
  homepage?: string
  repository?: string
  license?: string
}

// ============================================
// 场景权限声明
// ============================================

export type ScenarioPermission =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'database:connect'
  | 'database:query'
  | 'network:request'
  | 'terminal:execute'
  | 'clipboard:read'
  | 'clipboard:write'
  | 'notification:send'
  | 'system:info'

// ============================================
// 场景版本信息
// ============================================

export interface ScenarioVersionInfo {
  version: string
  changelog?: string
  minAppVersion?: string
  releasedAt?: number
  isStable?: boolean
}

// ============================================
// 场景健康检查报告
// ============================================

export interface ScenarioHealthReport {
  scenarioId: string
  status: ScenarioLifecycleState
  uptime?: number
  lastError?: string
  lastActivatedAt?: number
  toolCount: number
  ipcHandlerCount: number
  componentCount: number
  memoryUsage?: number
  checks: ScenarioHealthCheck[]
}

export interface ScenarioHealthCheck {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  latency?: number
}

// ============================================
// 场景工具定义（增强版）
// ============================================

export interface ScenarioToolDefinition {
  name: string
  definition: ToolDefinition
  executor: ToolExecutor
  version?: string
  deprecated?: boolean
  replacement?: string
}

// ============================================
// 场景 IPC 处理器
// ============================================

export interface ScenarioIpcHandler {
  channel: string
  handler: (...args: unknown[]) => unknown | Promise<unknown>
}

// ============================================
// 场景组件注册
// ============================================

export interface ScenarioComponentRegistry {
  [componentId: string]: React.ComponentType<unknown>
}

// ============================================
// 场景数据总线消息
// ============================================

export interface ScenarioDataMessage {
  type: string
  sourceScenarioId: string
  targetScenarioId?: string
  payload: unknown
  timestamp: number
  correlationId?: string
}

export interface ScenarioDataSubscription {
  id: string
  scenarioId: string
  messageType: string
  handler: (message: ScenarioDataMessage) => void
}

// ============================================
// 场景共享数据空间
// ============================================

export interface ScenarioSharedDataEntry {
  key: string
  value: unknown
  ownerScenarioId: string
  updatedAt: number
  version: number
  readOnly?: boolean
}

// ============================================
// 场景数据库脚本
// ============================================

export interface ScenarioDbScript {
  id: string
  description?: string
  sql: string
}

export interface ScenarioSqlResult {
  success: boolean
  rowsAffected?: number
  rows?: Record<string, unknown>[]
  columns?: string[]
  error?: string
  executionTime?: number
}

// ============================================
// 场景模块上下文（增强版）
// ============================================

export interface ScenarioModuleContext {
  scenarioId: string
  workspacePath: string | null
  version: string
  registerTools: (tools: ScenarioToolDefinition[]) => void
  unregisterTools: (toolNames: string[]) => void
  registerIpcHandlers: (handlers: ScenarioIpcHandler[]) => void
  unregisterIpcHandlers: (channels: string[]) => void
  publishData: (type: string, payload: unknown, targetScenarioId?: string) => void
  subscribeData: (messageType: string, handler: (message: ScenarioDataMessage) => void) => () => void
  setSharedData: (key: string, value: unknown, readOnly?: boolean) => void
  getSharedData: (key: string) => unknown
  getLogger: () => ScenarioLogger
  getHealthReporter: () => ScenarioHealthReporter
  executeSql: (sql: string) => Promise<ScenarioSqlResult>
  getDatabasePath: () => string
}

// ============================================
// 场景日志接口
// ============================================

export interface ScenarioLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

// ============================================
// 场景健康上报接口
// ============================================

export interface ScenarioHealthReporter {
  reportCheck(name: string, status: 'healthy' | 'degraded' | 'unhealthy', message?: string): void
  reportError(error: string): void
}

// ============================================
// 场景模块接口（增强版）
// ============================================

export interface ScenarioModule {
  id: string
  version: string

  getManifest: () => ScenarioManifest
  getPlugin: () => ScenarioPlugin

  getTools?: () => ScenarioToolDefinition[]
  getIpcHandlers?: () => ScenarioIpcHandler[]
  getComponents?: () => ScenarioComponentRegistry

  getInstallScripts?: () => ScenarioDbScript[]
  getUninstallScripts?: () => ScenarioDbScript[]

  onInstall?: (context: ScenarioModuleContext) => Promise<void>
  onActivate?: (context: ScenarioModuleContext) => Promise<void>
  onDeactivate?: (context: ScenarioModuleContext) => Promise<void>
  onUninstall?: (context: ScenarioModuleContext) => Promise<void>

  onHealthCheck?: () => Promise<ScenarioHealthCheck[]>

  getDependencies?: () => ScenarioDependency[]
}

// ============================================
// 场景加载器事件
// ============================================

export type ScenarioLoaderEvent =
  | { type: 'registered'; scenarioId: string; version: string }
  | { type: 'unregistered'; scenarioId: string }
  | { type: 'activating'; scenarioId: string }
  | { type: 'activated'; scenarioId: string }
  | { type: 'deactivating'; scenarioId: string }
  | { type: 'deactivated'; scenarioId: string }
  | { type: 'error'; scenarioId: string; error: string }
  | { type: 'version-changed'; scenarioId: string; oldVersion: string; newVersion: string }

// ============================================
// 场景注册表条目
// ============================================

export interface ScenarioRegistryEntry {
  module: ScenarioModule
  manifest: ScenarioManifest
  plugin: ScenarioPlugin
  state: ScenarioLifecycleState
  registeredToolNames: string[]
  registeredIpcChannels: string[]
  activatedAt?: number
  lastError?: string
  versionHistory: ScenarioVersionInfo[]
}
