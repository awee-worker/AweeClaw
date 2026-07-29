/**
 * 编程式场景 SDK API
 *
 * 编程式场景（ESM bundle）通过此 API 与宿主应用交互。
 * 与 SandboxAPI 不同，此 API 运行在主线程中，直接提供
 * React 组件、状态管理、样式注入等高级能力。
 *
 * 使用方式（在场景 ESM bundle 中）：
 * ```ts
 * const sdk = window.__AWEECLAW_SDK__
 * const { react, zustand } = sdk.shared
 * const { injectStyle, removeStyle } = sdk.style
 * const { getState, setState } = sdk.storage
 * // 调用 MCP 插件工具（需在 scenario.json 声明 "mcp:call" 权限）
 * const r = await sdk.mcp.callTool({ serverId: 'design-image-processor', toolName: 'resize', arguments: { ... } })
 * // 调用内置工具（按声明权限受 PermissionGuard 约束）
 * const f = await sdk.tools.callBuiltin('read_file', { path: '/abs/file' })
 * // 读取技能（prompt 片段，注入自身 systemPrompt）
 * const skills = await sdk.skills.list()
 * ```
 *
 * API 模块：
 * - shared: 共享依赖（React、zustand、lucide-react）
 * - style: 样式注入/移除
 * - storage: 场景状态持久化
 * - context: 场景上下文信息
 * - dataBus: 场景间数据通信
 * - logger: 日志记录
 * - health: 健康检查上报
 * - mcp: MCP 插件工具调用（前置 mcp:call 权限校验 + 审计，不走 HITL 审批）
 * - tools: 内置工具调用（前置 PermissionGuard 校验 + 审计，不走 HITL 审批）
 * - skills: 技能读取（只读 prompt 片段，无副作用，无需权限）
 *
 * 安全模型：
 * - 场景代码主动调用（非 AI 自主决策）一律不走 HITL 审批，
 *   但每次调用经 scenarioMonitor 审计（toolName / 耗时 / 成败）。
 * - 权限前置校验：未声明的权限直接返回 { success:false, error }，绝不抛异常。
 */

import type React from 'react'
import type { SharedDependencyRegistry } from './SharedDependencyProvider'
import { sharedDependencyProvider } from './SharedDependencyProvider'
import { scenarioStyleManager } from './ScenarioStyleManager'
import { scenarioDataBus } from './ScenarioDataBus'
import { scenarioMonitor } from './ScenarioMonitor'
import { PermissionGuard } from './PermissionGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { api } from '@services/electronBridge'
import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import { initializeTools } from '@intelligence/toolkit/toolExecutors'
import { TOOL_DEFINITIONS, TOOL_CONFIGS } from '@configuration/toolDefinitions'
import type { ScenarioPermission } from '@shared/protocols/scenario-arch'
import type { ToolExecutionContext } from '@shared/protocols/modelProtocol'

export interface ScenarioStorageAPI {
  getState: (key: string) => unknown
  setState: (key: string, value: unknown) => void
  removeState: (key: string) => void
  getAllKeys: () => string[]
}

export interface ScenarioStyleAPI {
  injectFromUrl: (cssUrl: string) => void
  injectInline: (cssContent: string, namespace?: boolean) => void
  remove: () => void
  updateInline: (cssContent: string, namespace?: boolean) => void
}

export interface ScenarioContextAPI {
  scenarioId: string
  version: string
  appVersion: string
  workspacePath: string | null
  platform: string
  locale: string
}

export interface ScenarioDataBusAPI {
  publish: (type: string, payload: unknown, targetScenarioId?: string) => void
  subscribe: (messageType: string, handler: (payload: unknown, sourceScenarioId: string) => void) => () => void
  setSharedData: (key: string, value: unknown, readOnly?: boolean) => void
  getSharedData: (key: string) => unknown
}

export interface ScenarioLoggerAPI {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

export interface ScenarioHealthAPI {
  reportCheck: (name: string, status: 'healthy' | 'degraded' | 'unhealthy', message?: string) => void
  reportError: (error: string) => void
}

// ============================================
// MCP 插件工具调用 API
// ============================================

/** MCP 工具调用请求 */
export interface ScenarioMcpCallRequest {
  /** MCP 服务器 ID（插件安装后注册的 serverId） */
  serverId: string
  /** 工具名（不含 mcp_ 前缀，如 "resize"） */
  toolName: string
  /** 工具入参 */
  arguments: Record<string, unknown>
}

/** MCP 工具调用结果（永不抛异常，统一返回结构） */
export interface ScenarioMcpCallResult {
  success: boolean
  /** MCP 工具返回的内容（数组或文本） */
  content?: unknown
  error?: string
}

/** MCP 服务器概要 */
export interface ScenarioMcpServer {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'error' | string
}

/** MCP 工具概要 */
export interface ScenarioMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ScenarioMcpAPI {
  /**
   * 调用 MCP 插件工具
   *
   * 前置校验场景是否声明 `mcp:call` 权限；通过后转发到主进程 MCP 管理器，
   * 不走 HITL 审批，但经 scenarioMonitor 审计。
   */
  callTool: (request: ScenarioMcpCallRequest) => Promise<ScenarioMcpCallResult>
  /** 列出所有 MCP 服务器及其连接状态 */
  listServers: () => Promise<ScenarioMcpServer[]>
  /** 查询单个服务器状态（不存在返回 'disconnected'） */
  getServerStatus: (serverId: string) => Promise<'connected' | 'disconnected' | 'error' | string>
  /** 列出指定服务器暴露的工具（服务器未连接返回空数组） */
  listTools: (serverId: string) => Promise<ScenarioMcpTool[]>
}

// ============================================
// 内置工具调用 API
// ============================================

/** 内置工具调用结果（永不抛异常，统一返回结构） */
export interface ScenarioToolCallResult {
  success: boolean
  result: string
  error?: string
}

/** 内置工具概要 */
export interface ScenarioBuiltinToolInfo {
  name: string
  description: string
  approvalType: string
}

export interface ScenarioToolsAPI {
  /**
   * 调用内置工具（read_file / write_file / run_command 等）
   *
   * 仅允许调用内置工具（拒绝 mcp_ 前缀与场景工具，避免递归）。
   * 前置过 PermissionGuard.checkTool；skipMainApproval:true 确保不走 HITL 审批。
   */
  callBuiltin: (toolName: string, args: Record<string, unknown>) => Promise<ScenarioToolCallResult>
  /** 列出当前可用的内置工具 */
  listAvailable: () => ScenarioBuiltinToolInfo[]
  /** 判断某个内置工具是否已注册 */
  has: (toolName: string) => boolean
}

// ============================================
// 技能读取 API
// ============================================

/** 技能概要（技能是 prompt 片段，非可调用工具） */
export interface ScenarioSkillInfo {
  name: string
  description: string
  scope: 'global' | 'workspace'
}

export interface ScenarioSkillContent {
  name: string
  content: string
  scope: 'global' | 'workspace'
}

export interface ScenarioSkillsAPI {
  /** 列出所有可用技能（global + workspace） */
  list: () => Promise<ScenarioSkillInfo[]>
  /** 读取指定技能内容（不存在返回 null） */
  read: (name: string) => Promise<ScenarioSkillContent | null>
}

export interface ScenarioSDK {
  shared: {
    react: typeof React
    reactDom: typeof import('react-dom/client')
    zustand: typeof import('zustand')
    lucideReact: typeof import('lucide-react')
    xyflow: typeof import('@xyflow/react')
    framerMotion: typeof import('framer-motion')
    getModule: <K extends keyof SharedDependencyRegistry>(name: K) => SharedDependencyRegistry[K] | null
  }
  style: ScenarioStyleAPI
  storage: ScenarioStorageAPI
  context: ScenarioContextAPI
  dataBus: ScenarioDataBusAPI
  logger: ScenarioLoggerAPI
  health: ScenarioHealthAPI
  /** MCP 插件工具调用（向后兼容：老客户端无此字段，场景调用前需 `if (sdk.mcp)` 检测） */
  mcp: ScenarioMcpAPI
  /** 内置工具调用 */
  tools: ScenarioToolsAPI
  /** 技能读取 */
  skills: ScenarioSkillsAPI
}

declare global {
  interface Window {
    __AWEECLAW_SDK__: ScenarioSDK | undefined
  }
}

const SDK_GLOBAL_KEY = '__AWEECLAW_SDK__'

export function createScenarioSDK(
  scenarioId: string,
  version: string,
  workspacePath: string | null,
  declaredPermissions: ScenarioPermission[] = [],
): ScenarioSDK {
  const storagePrefix = `scenario:${scenarioId}:`

  // 权限守卫：场景在 scenario.json 的 permissions 字段声明的权限集合
  const permissionGuard = new PermissionGuard(scenarioId, declaredPermissions)

  const storageApi: ScenarioStorageAPI = {
    getState: (key: string) => {
      try {
        return StorageService.get(`${storagePrefix}${key}`) ?? undefined
      } catch {
        return undefined
      }
    },
    setState: (key: string, value: unknown) => {
      try {
        StorageService.set(`${storagePrefix}${key}`, value)
      } catch (err) {
        logger.agent.warn(`[SDK:Storage] Failed to set state for key "${key}":`, err)
      }
    },
    removeState: (key: string) => {
      StorageService.remove(`${storagePrefix}${key}`)
    },
    getAllKeys: () => {
      const keys: string[] = []
      // StorageService 使用 aweeclaw: 前缀，需要匹配完整前缀
      const fullPrefix = `aweeclaw:${storagePrefix}`
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(fullPrefix)) {
          keys.push(k.slice(fullPrefix.length))
        }
      }
      return keys
    },
  }

  const styleApi: ScenarioStyleAPI = {
    injectFromUrl: (cssUrl: string) => {
      scenarioStyleManager.injectFromUrl(scenarioId, cssUrl)
    },
    injectInline: (cssContent: string, namespace?: boolean) => {
      scenarioStyleManager.injectInline(scenarioId, cssContent, namespace)
    },
    remove: () => {
      scenarioStyleManager.removeScenarioStyles(scenarioId)
    },
    updateInline: (cssContent: string, namespace?: boolean) => {
      scenarioStyleManager.updateInlineStyle(scenarioId, cssContent, namespace)
    },
  }

  const sharedDeps = sharedDependencyProvider.get()

  const contextApi: ScenarioContextAPI = {
    scenarioId,
    version,
    appVersion: sharedDeps?.appVersion || '0.0.0',
    workspacePath,
    platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin'
      : navigator.platform.toLowerCase().includes('win') ? 'win32'
      : 'linux',
    locale: navigator.language || 'en',
  }

  const dataBusApi: ScenarioDataBusAPI = {
    publish: (type: string, payload: unknown, targetScenarioId?: string) => {
      scenarioDataBus.publish(scenarioId, type, payload, targetScenarioId)
    },
    subscribe: (messageType: string, handler: (payload: unknown, sourceScenarioId: string) => void) => {
      return scenarioDataBus.subscribe(scenarioId, messageType, (message) => {
        handler(message.payload, message.sourceScenarioId)
      })
    },
    setSharedData: (key: string, value: unknown, readOnly?: boolean) => {
      scenarioDataBus.setSharedData(scenarioId, key, value, readOnly)
    },
    getSharedData: (key: string) => {
      return scenarioDataBus.getSharedData(key)
    },
  }

  const scenarioLogger = scenarioMonitor.createLogger(scenarioId)
  const loggerApi: ScenarioLoggerAPI = {
    info: scenarioLogger.info.bind(scenarioLogger),
    warn: scenarioLogger.warn.bind(scenarioLogger),
    error: scenarioLogger.error.bind(scenarioLogger),
    debug: scenarioLogger.debug.bind(scenarioLogger),
  }

  const healthReporter = scenarioMonitor.createHealthReporter(scenarioId)
  const healthApi: ScenarioHealthAPI = {
    reportCheck: healthReporter.reportCheck.bind(healthReporter),
    reportError: healthReporter.reportError.bind(healthReporter),
  }

  // ─────────────────────────────────────────────
  // MCP 插件工具调用命名空间
  // ─────────────────────────────────────────────
  const mcpApi: ScenarioMcpAPI = {
    callTool: async (request): Promise<ScenarioMcpCallResult> => {
      const startTs = Date.now()
      // 前置权限校验：MCP 工具统一要求 mcp:call
      const perm = permissionGuard.checkTool(`mcp_${request.serverId}__${request.toolName}`)
      if (!perm.allowed) {
        logger.agent.warn(`[SDK:Mcp] Blocked callTool ${request.serverId}.${request.toolName}: ${perm.reason}`)
        scenarioMonitor.recordToolExecution(scenarioId, `mcp_${request.serverId}__${request.toolName}`, Date.now() - startTs, false)
        return { success: false, error: perm.reason || `缺少 mcp:call 权限` }
      }
      try {
        const result = await api.mcp.callTool({
          serverId: request.serverId,
          toolName: request.toolName,
          arguments: request.arguments || {},
        })
        const success = result?.success !== false
        scenarioMonitor.recordToolExecution(
          scenarioId,
          `mcp_${request.serverId}__${request.toolName}`,
          Date.now() - startTs,
          success,
        )
        return {
          success,
          content: (result as { content?: unknown })?.content,
          error: (result as { error?: string })?.error,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[SDK:Mcp] callTool error ${request.serverId}.${request.toolName}:`, err)
        scenarioMonitor.recordToolExecution(
          scenarioId,
          `mcp_${request.serverId}__${request.toolName}`,
          Date.now() - startTs,
          false,
        )
        return { success: false, error: message }
      }
    },

    listServers: async (): Promise<ScenarioMcpServer[]> => {
      try {
        const resp = await api.mcp.getServersState()
        const servers = (resp as { servers?: Array<{ id?: string; config?: { name?: string }; name?: string; status?: string }> })?.servers || []
        return servers.map((s) => ({
          id: s.id || s.config?.name || s.name || '',
          name: s.config?.name || s.name || s.id || '',
          status: s.status || 'disconnected',
        }))
      } catch (err) {
        logger.agent.warn(`[SDK:Mcp] listServers error:`, err)
        return []
      }
    },

    getServerStatus: async (serverId: string): Promise<string> => {
      try {
        const resp = await api.mcp.getServersState()
        const servers = (resp as { servers?: Array<{ id?: string; status?: string }> })?.servers || []
        const found = servers.find((s) => s.id === serverId)
        return found?.status || 'disconnected'
      } catch (err) {
        logger.agent.warn(`[SDK:Mcp] getServerStatus error:`, err)
        return 'disconnected'
      }
    },

    listTools: async (serverId: string): Promise<ScenarioMcpTool[]> => {
      try {
        const resp = await api.mcp.getServersState()
        const servers = (resp as { servers?: Array<{ id?: string; tools?: ScenarioMcpTool[]; status?: string }> })?.servers || []
        const found = servers.find((s) => s.id === serverId)
        if (!found || found.status !== 'connected') return []
        return (found.tools || []).map((t) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
        }))
      } catch (err) {
        logger.agent.warn(`[SDK:Mcp] listTools error:`, err)
        return []
      }
    },
  }

  // ─────────────────────────────────────────────
  // 内置工具调用命名空间
  // ─────────────────────────────────────────────
  // 内置执行器按需懒加载（仅在 AI agent loop 启动时由 initializeTools 注册），
  // 因此 listAvailable/has 以静态目录 TOOL_DEFINITIONS 为真相源（全量可加载工具），
  // callBuiltin 执行前主动调 initializeTools()（幂等）确保执行器已注册。
  const toolsApi: ScenarioToolsAPI = {
    callBuiltin: async (toolName, args): Promise<ScenarioToolCallResult> => {
      const startTs = Date.now()
      // 仅允许内置工具：拒绝 mcp_ 前缀（走 sdk.mcp）与场景工具（避免递归）
      if (!toolName || toolName.startsWith('mcp_')) {
        return { success: false, result: '', error: `仅支持内置工具，MCP 工具请使用 sdk.mcp.callTool` }
      }
      if (!(toolName in TOOL_DEFINITIONS)) {
        return { success: false, result: '', error: `工具 "${toolName}" 不是内置工具，不允许跨场景调用` }
      }
      // 前置权限校验（复用 TOOL_PERMISSION_MAP 映射，不依赖运行时注册状态）
      const perm = permissionGuard.checkTool(toolName)
      if (!perm.allowed) {
        logger.agent.warn(`[SDK:Tools] Blocked callBuiltin ${toolName}: ${perm.reason}`)
        scenarioMonitor.recordToolExecution(scenarioId, toolName, Date.now() - startTs, false)
        return { success: false, result: '', error: perm.reason || `缺少调用 ${toolName} 所需权限` }
      }
      // 确保内置执行器已注册到 toolRegistry（幂等：registerAll 每次更新 globalExecutors）
      try {
        await initializeTools()
      } catch (err) {
        logger.agent.warn(`[SDK:Tools] initializeTools failed (will try execute anyway):`, err)
      }
      // 构造场景专用执行上下文：skipMainApproval 确保不走 HITL 审批
      const ctx: ToolExecutionContext = {
        workspacePath,
        chatMode: 'agent',
        toolCallId: `scenario-${scenarioId}-${Date.now()}`,
        assistantId: `scenario:${scenarioId}`,
        currentAssistantId: `scenario:${scenarioId}`,
        skipMainApproval: true,
      }
      try {
        const result = await toolRegistry.execute(toolName, args || {}, ctx)
        const success = result.success !== false
        scenarioMonitor.recordToolExecution(scenarioId, toolName, Date.now() - startTs, success)
        return {
          success,
          result: result.result ?? '',
          error: result.error,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[SDK:Tools] callBuiltin error ${toolName}:`, err)
        scenarioMonitor.recordToolExecution(scenarioId, toolName, Date.now() - startTs, false)
        return { success: false, result: '', error: message }
      }
    },

    listAvailable: (): ScenarioBuiltinToolInfo[] => {
      // 以静态目录为真相源，不依赖运行时注册状态
      return Object.entries(TOOL_DEFINITIONS)
        .filter(([name]) => !name.startsWith('mcp_'))
        .map(([name, def]) => ({
          name,
          description: def.description || '',
          approvalType: String(TOOL_CONFIGS[name]?.approvalType || 'none'),
        }))
    },

    has: (toolName: string): boolean => {
      if (!toolName || toolName.startsWith('mcp_')) return false
      return toolName in TOOL_DEFINITIONS
    },
  }

  // ─────────────────────────────────────────────
  // 技能读取命名空间（只读，无副作用，无需权限）
  // ─────────────────────────────────────────────
  // 将场景 workspacePath 透传，使 workspace 级技能（.aweeclaw/skills/）也被纳入
  const workspacePathsArr = workspacePath ? [workspacePath] : undefined
  const skillsApi: ScenarioSkillsAPI = {
    list: async (): Promise<ScenarioSkillInfo[]> => {
      try {
        const result = await api.skills.list(workspacePathsArr)
        const items = (result as { skills?: ScenarioSkillInfo[] })?.skills
        return items || []
      } catch (err) {
        logger.agent.warn(`[SDK:Skills] list error:`, err)
        return []
      }
    },

    read: async (name: string): Promise<ScenarioSkillContent | null> => {
      try {
        const result = await api.skills.read(name, workspacePathsArr)
        const skill = (result as { skill?: ScenarioSkillContent })?.skill
        return skill || null
      } catch (err) {
        logger.agent.warn(`[SDK:Skills] read error:`, err)
        return null
      }
    },
  }

  const sdk: ScenarioSDK = {
    // shared 字段使用 getter 动态读取，避免创建 SDK 时 sharedDeps 尚未注入导致永久 undefined。
    // 场景 bundle 顶层代码可能在 import 时就访问 shared.zustand，
    // 此时必须能读到最新的 sharedDependencyProvider 数据。
    get shared() {
      const deps = sharedDependencyProvider.get()
      return {
        react: deps?.modules.react as typeof React,
        reactDom: deps?.modules.reactDom as typeof import('react-dom/client'),
        zustand: deps?.modules.zustand as typeof import('zustand'),
        lucideReact: deps?.modules.lucideReact as typeof import('lucide-react'),
        xyflow: deps?.modules.xyflow as typeof import('@xyflow/react'),
        framerMotion: deps?.modules.framerMotion as typeof import('framer-motion'),
        getModule: <K extends keyof SharedDependencyRegistry>(name: K) => {
          return sharedDependencyProvider.getModule(name)
        },
      }
    },
    style: styleApi,
    storage: storageApi,
    context: contextApi,
    dataBus: dataBusApi,
    logger: loggerApi,
    health: healthApi,
    mcp: mcpApi,
    tools: toolsApi,
    skills: skillsApi,
  }

  return sdk
}

export function injectScenarioSDK(sdk: ScenarioSDK): void {
  ;(window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY] = sdk
}

export function removeScenarioSDK(): void {
  delete (window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY]
}

export function getScenarioSDK(): ScenarioSDK | null {
  return (window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY] as ScenarioSDK | null
}
