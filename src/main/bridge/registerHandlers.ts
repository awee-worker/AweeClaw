/**
 * 安全的 IPC handlers 统一导出
 * 所有高危操作都已经过安全重构
 */

import { logger } from '@shared/toolkit/LogEngine'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'

import { registerWindowHandlers } from './windowLifecycle' // 窗口控制
import { registerSettingsHandlers } from './preferenceSync' // 设置
import { registerSearchHandlers } from './searchEngine' // 搜索
import { registerLLMHandlers, cleanupLLMService, cleanupAllLLMServices } from './modelGateway' // LLM
import { registerIndexingHandlers } from './indexOrchestrator' // 索引
import { registerLspHandlers } from './languageServerBridge' // LSP
import { registerHttpHandlers } from './httpTransport' // HTTP
import { registerMcpHandlers, cleanupMcpHandlers } from './toolProtocolBridge' // MCP
import { registerMcpEnhancedHandlers } from './mcpEnhancedBridge' // MCP 增强
import { registerEmailHandlers } from './emailService' // 邮件服务
import { registerResourcesHandlers } from './assetManager' // 资源
import { registerDebugHandlers } from './sessionInspector' // 调试
import { registerHealthCheckHandlers } from './providerMonitor' // 健康检查
import { registerRemoteExecutionHandlers } from './remoteExecution' // 远程 Shell / SFTP
import { registerSkillsHandlers } from './skillRegistry' // Skills
import { registerChannelHandlers } from './channel' // Channel 多渠道
import { registerAgentHandlers } from './agent' // Agent 路由与隔离
import { registerSecurityHandlers } from './security' // 安全模型
import { registerAutomationHandlers } from './automation' // 自动化引擎
import { registerDoctorHandlers } from './doctor' // 诊断工具
import { registerSessionLifecycleHandlers } from './sessionLifecycle' // Session 生命周期
import { registerGatewayHandlers } from './gateway' // Gateway 守护进程
import { registerPythonHandlers } from './python' // Python 环境
import { registerDataIpcHandlers } from './data' // 数据服务
import { registerScenarioDbIpcHandlers } from './scenarioDb' // 场景数据库
import { registerScenarioInstallIpcHandlers, registerScenarioMarketplaceHandlers } from './scenarioInstall' // 场景安装
import { registerAuditHandlers, cleanupAuditHandlers } from './audit' // 审计日志
import { registerSettingsDbIpcHandlers } from './settingsDb' // 设置数据库
import { registerSessionDbIpcHandlers } from './sessionDb' // 会话数据库
import { registerMemoryDbIpcHandlers } from './memoryDb' // 记忆数据库

// 安全模块
import {
  securityManager,
  registerSecureTerminalHandlers,
  registerSecureFileHandlers,
  cleanupSecureFileWatcher,
  cleanupTerminals,
  updateWhitelist,
  getWhitelist,
} from '../guard/index'
// 上下文类型
export interface IPCContext {
  // 获取窗口，如果没有指定窗口 ID，则返回最后一个活跃窗口
  getMainWindow: (windowId?: number) => BrowserWindow | null
  // isEmpty: 是否是空窗口，用于创建新窗口
  createWindow: (isEmpty?: boolean) => BrowserWindow
  /** 根据 key 路由到正确的 store */
  resolveStore: (key: string) => Store
  credentialsStore: Store
  preferencesStore: Store
  workspaceMetaStore: Store
  bootstrapStore: Store
  // 窗口-工作区管理（用于单项目单窗口模式）
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
  getWindowWorkspace?: (windowId: number) => string[] | null
}

/**
 * IPC Handler 注册状态追踪
 * 防止重复注册导致的不可预期行为
 */
const registeredHandlers = new Set<string>()

function registerOnce(name: string, registerFn: () => void): void {
  if (registeredHandlers.has(name)) {
    logger.ipc.warn(`[IPC] Handler "${name}" already registered, skipping`)
    return
  }
  try {
    registerFn()
    registeredHandlers.add(name)
  } catch (err) {
    logger.ipc.error(`[IPC] Failed to register handler "${name}":`, err)
  }
}

export function isHandlerRegistered(name: string): boolean {
  return registeredHandlers.has(name)
}

export function clearHandlerRegistry(): void {
  registeredHandlers.clear()
}

/**
 * 注册所有安全的 IPC handlers
 */
export function registerAllHandlers(context: IPCContext) {
  const { getMainWindow, createWindow, resolveStore, preferencesStore, workspaceMetaStore, bootstrapStore } = context

  // 窗口控制
  registerOnce('window', () => registerWindowHandlers(createWindow))

  // 文件操作（安全版）
  registerOnce('secure-file', () => registerSecureFileHandlers(getMainWindow, workspaceMetaStore, (event) => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    if (event && context.getWindowWorkspace) {
      const windowId = event.sender.id
      const windowRoots = context.getWindowWorkspace(windowId)
      if (windowRoots && windowRoots.length > 0) {
        return { roots: windowRoots }
      }
    }
    // 回退到全局存储
    return workspaceMetaStore.get('lastWorkspaceSession') as { roots: string[] } | null
  }, {
    findWindowByWorkspace: context.findWindowByWorkspace,
    setWindowWorkspace: context.setWindowWorkspace,
  }))

  // 设置（传入 resolveStore 和各 store 引用）
  registerOnce('settings', () => registerSettingsHandlers(resolveStore, preferencesStore, bootstrapStore, {
    securityManager,
    updateWhitelist,
    getWhitelist
  }))

  // 终端（安全版）- 传入窗口工作区获取函数实现多窗口隔离
  registerOnce('secure-terminal', () => registerSecureTerminalHandlers(getMainWindow, (event) => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    if (event && context.getWindowWorkspace) {
      const windowId = event.sender.id
      const windowRoots = context.getWindowWorkspace(windowId)
      if (windowRoots && windowRoots.length > 0) {
        return { roots: windowRoots }
      }
    }
    // 回退到全局存储
    return workspaceMetaStore.get('lastWorkspaceSession') as { roots: string[] } | null
  }, context.getWindowWorkspace))

  // 搜索
  registerOnce('search', () => registerSearchHandlers())

  // LLM
  registerOnce('llm', () => registerLLMHandlers(getMainWindow))

  // 索引 - 传入 workspaceMetaStore 以读取保存的 embedding 配置
  registerOnce('indexing', () => registerIndexingHandlers(getMainWindow, workspaceMetaStore))

  // LSP 语言服务
  registerOnce('lsp', () => registerLspHandlers(preferencesStore))

  // HTTP 请求（用于 web_search / read_url）
  registerOnce('http', () => registerHttpHandlers())

  // MCP 服务
  registerOnce('mcp', () => registerMcpHandlers(getMainWindow))

  // MCP 增强服务
  registerOnce('mcp-enhanced', () => registerMcpEnhancedHandlers(getMainWindow))

  // 邮件服务
  registerOnce('email', () => registerEmailHandlers())

  // 静态资源
  registerOnce('resources', () => registerResourcesHandlers())

  // 调试服务
  registerOnce('debug', () => registerDebugHandlers())

  // 健康检查
  registerOnce('health-check', () => registerHealthCheckHandlers())

  // 远程 Shell / SFTP
  registerOnce('remote-execution', () => registerRemoteExecutionHandlers())

  // Skills
  registerOnce('skills', () => registerSkillsHandlers())

  // Channel 多渠道
  registerOnce('channel', () => registerChannelHandlers(getMainWindow, resolveStore('config')))

  // Agent 路由与隔离
  registerOnce('agent', () => registerAgentHandlers())

  // 安全模型（Tool Approval + Sandbox）
  registerOnce('security', () => registerSecurityHandlers(getMainWindow))

  // 自动化引擎（Cron 调度器）
  registerOnce('automation', () => registerAutomationHandlers())

  // 诊断工具
  registerOnce('doctor', () => registerDoctorHandlers())

  // Session 生命周期
  registerOnce('session-lifecycle', () => registerSessionLifecycleHandlers())

  // Gateway 守护进程
  registerOnce('gateway', () => registerGatewayHandlers())

  // Python 环境
  registerOnce('python', () => registerPythonHandlers())

  // 数据服务
  registerOnce('data', () => registerDataIpcHandlers())

  // 场景数据库
  registerOnce('scenario-db', () => registerScenarioDbIpcHandlers())

  // 场景安装
  registerOnce('scenario-install', () => registerScenarioInstallIpcHandlers(getMainWindow))

  // 场景市场
  registerOnce('scenario-marketplace', () => registerScenarioMarketplaceHandlers())

  // 审计日志
  registerOnce('audit', () => registerAuditHandlers())

  // 设置数据库
  registerOnce('settings-db', () => registerSettingsDbIpcHandlers(preferencesStore))

  // 会话数据库
  registerOnce('session-db', () => registerSessionDbIpcHandlers())

  // 记忆数据库
  registerOnce('memory-db', () => registerMemoryDbIpcHandlers())

  logger.ipc.info(`[Security] 所有安全IPC处理器已注册 (${registeredHandlers.size} 个)`)
}

/**
 * 清理所有资源
 */
export function cleanupAllHandlers() {
  logger.ipc.info('[IPC] Cleaning up all handlers...')
  cleanupTerminals()
  cleanupSecureFileWatcher()
  cleanupMcpHandlers()
  cleanupAllLLMServices()
  cleanupAuditHandlers()
  // DebugService 清理由 performGlobalCleanup 中异步处理（需要 await）
  logger.ipc.info('[IPC] All handlers cleaned up')
}

export { cleanupLLMService }

