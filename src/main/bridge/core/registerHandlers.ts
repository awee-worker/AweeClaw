/**
 * IPC Handler 统一注册入口
 *
 * 职责：
 * - 集中注册所有领域 IPC handler，按领域分组加载
 * - 通过 registerOnce 防止重复注册
 * - 统一暴露 cleanupAllHandlers 供应用退出时清理资源
 *
 * 分组说明（与 bridge/ 子目录一一对应）：
 * - window      窗口生命周期 / 自动更新 / 静态资源
 * - ai          LLM 模型网关 / Provider 健康检查 / Agent 路由 / Skills
 * - code-intel  代码搜索 / 索引 / LSP 语言服务
 * - security    安全模型 / 审计日志
 * - storage     设置 / 会话 / 记忆 / 场景数据库
 * - scenario    场景安装与市场
 * - messaging   多渠道通信 / 邮件服务
 * - system      诊断 / Python / 数据服务 / 桌面控制 / Gateway / 自动化
 * - network     HTTP 请求 / 远程 Shell / SFTP
 * - mcp         MCP 工具协议 / MCP 增强
 * - session     调试会话 / Session 生命周期
 */

import { logger } from '@shared/toolkit/LogEngine'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'

// ── window ──────────────────────────────────────────────
import { registerWindowHandlers } from '../window/windowLifecycle'
import { registerResourcesHandlers } from '../window/assetManager'

// ── ai ───────────────────────────────────────────────────
import { registerLLMHandlers, cleanupLLMService, cleanupAllLLMServices } from '../ai/modelGateway'
import { registerHealthCheckHandlers } from '../ai/providerMonitor'
import { registerAgentHandlers } from '../ai/agent'
import { registerSkillsHandlers } from '../ai/skillRegistry'

// ── code-intel ──────────────────────────────────────────
import { registerSearchHandlers } from '../code-intel/searchEngine'
import { registerIndexingHandlers } from '../code-intel/indexOrchestrator'
import { registerLspHandlers } from '../code-intel/languageServerBridge'

// ── security ────────────────────────────────────────────
import { registerSecurityHandlers } from '../security/security'
import { registerAuditHandlers, cleanupAuditHandlers } from '../security/audit'

// ── storage ─────────────────────────────────────────────
import { registerSettingsHandlers } from '../storage/preferenceSync'
import { registerSettingsDbIpcHandlers } from '../storage/settingsDb'
import { registerSessionDbIpcHandlers } from '../storage/sessionDb'
import { registerMemoryDbIpcHandlers } from '../storage/memoryDb'
import { registerScenarioDbIpcHandlers } from '../storage/scenarioDb'

// ── scenario ────────────────────────────────────────────
import { registerScenarioInstallIpcHandlers, registerScenarioMarketplaceHandlers } from '../scenario/scenarioInstall'
import { registerScenarioBuilderIpcHandlers } from '../scenario/scenarioBuilder'

// ── messaging ───────────────────────────────────────────
import { registerChannelHandlers } from '../messaging/channel'
import { registerEmailHandlers } from '../messaging/emailService'

// ── system ──────────────────────────────────────────────
import { registerDoctorHandlers } from '../system/doctor'
import { registerPythonHandlers } from '../system/python'
import { registerNodeHandlers } from '../system/node'
import { registerDataIpcHandlers } from '../system/data'
import { registerDesktopControlHandlers } from '../system/desktopControl'
import { registerGatewayHandlers } from '../system/gateway'
import { registerAutomationHandlers } from '../system/automation'

// ── network ─────────────────────────────────────────────
import { registerHttpHandlers } from '../network/httpTransport'
import { registerRemoteExecutionHandlers } from '../network/remoteExecution'

// ── mcp ─────────────────────────────────────────────────
import { registerMcpHandlers, cleanupMcpHandlers } from '../mcp/toolProtocolBridge'
import { registerMcpEnhancedHandlers } from '../mcp/mcpEnhancedBridge'

// ── session ─────────────────────────────────────────────
import { registerDebugHandlers } from '../session/sessionInspector'
import { registerSessionLifecycleHandlers } from '../session/sessionLifecycle'

// ── plugin ──────────────────────────────────────────────
import { registerPluginHandlers } from '../plugin/pluginBridge'

// ── clipboard ───────────────────────────────────────────
import { registerClipboardHandlers } from '../system/clipboardService'

// 安全模块（guard 目录）
import {
  securityManager,
  registerSecureTerminalHandlers,
  registerSecureFileHandlers,
  cleanupSecureFileWatcher,
  cleanupTerminals,
  updateWhitelist,
  getWhitelist,
  updateBlacklist,
  getBlacklist,
} from '../../guard/index'
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
    getWhitelist,
    updateBlacklist,
    getBlacklist,
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

  // Node.js 环境
  registerOnce('node', () => registerNodeHandlers())

  // 数据服务
  registerOnce('data', () => registerDataIpcHandlers())

  // 场景数据库
  registerOnce('scenario-db', () => registerScenarioDbIpcHandlers())

  // 场景安装
  registerOnce('scenario-install', () => registerScenarioInstallIpcHandlers(getMainWindow))

  // 场景开发助手（builder）
  registerOnce('scenario-builder', () => registerScenarioBuilderIpcHandlers(getMainWindow))

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

  // 桌面控制
  registerOnce('desktop-control', () => registerDesktopControlHandlers(getMainWindow))

  // 插件系统
  registerOnce('plugin', () => registerPluginHandlers({ getMainWindow }))

  // 剪贴板服务（读取原生剪贴板文件路径，用于粘贴文件到聊天）
  registerOnce('clipboard', () => registerClipboardHandlers())

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

