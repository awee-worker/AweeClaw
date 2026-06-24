/**
 * MCP 服务适配器
 *
 * 提供 Model Context Protocol 服务器管理能力，包括初始化、连接、工具调用等。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

/** MCP 服务器配置 */
export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** MCP 工具描述 */
export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** MCP 工具调用请求 */
export interface McpToolCallRequest {
  serverId: string
  toolName: string
  arguments: Record<string, unknown>
}

/** MCP 工具调用结果 */
export interface McpToolCallResult {
  success: boolean
  content?: unknown
  error?: string
}

/** MCP 服务器状态 */
export interface McpServerState {
  name: string
  status: 'connected' | 'disconnected' | 'error'
  tools?: McpTool[]
}

/* ------------------------------------------------------------------ */
/* Electron API 类型                                                   */
/* ------------------------------------------------------------------ */

interface McpElectronAPI {
  mcpInitialize?: (workspaces: string[]) => Promise<{ success: boolean; error?: string }>
  mcpGetServersState?: () => Promise<{ success: boolean; servers?: McpServerState[]; error?: string }>
  mcpConnectServer?: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpCallTool?: (request: McpToolCallRequest) => Promise<McpToolCallResult>
}

function getMcpAPI(): McpElectronAPI | null {
  const api = (globalThis as { electronAPI?: McpElectronAPI }).electronAPI
  return api || null
}

/* ------------------------------------------------------------------ */
/* MCP 服务                                                            */
/* ------------------------------------------------------------------ */

/**
 * MCP 服务
 *
 * 负责管理 MCP 服务器的初始化、连接、工具调用等操作。
 * 通过 Electron IPC 与主进程通信。
 */
export class McpService {
  private servers = new Map<string, McpServerConfig>()
  private serverStates = new Map<string, McpServerState>()
  private initialized = false

  /**
   * 初始化 MCP 服务
   *
   * @param workspaces 工作区路径列表
   */
  async initialize(workspaces: string[]): Promise<void> {
    const api = getMcpAPI()
    if (!api?.mcpInitialize) {
      throw new Error('MCP API not available')
    }

    const result = await api.mcpInitialize(workspaces)
    if (!result.success) {
      throw new Error(result.error || 'MCP initialization failed')
    }

    // 获取服务器状态
    if (api.mcpGetServersState) {
      const stateResult = await api.mcpGetServersState()
      if (stateResult.success && stateResult.servers) {
        for (const server of stateResult.servers) {
          this.serverStates.set(server.name, server)
        }
      }
    }

    this.initialized = true
  }

  /**
   * 连接到 MCP 服务器
   *
   * @param serverId 服务器 ID
   * @returns 是否连接成功
   */
  async connectServer(serverId: string): Promise<boolean> {
    const api = getMcpAPI()
    if (!api?.mcpConnectServer) {
      throw new Error('MCP API not available')
    }

    const result = await api.mcpConnectServer(serverId)
    if (result.success) {
      const state = this.serverStates.get(serverId)
      if (state) {
        state.status = 'connected'
      } else {
        this.serverStates.set(serverId, { name: serverId, status: 'connected' })
      }
      return true
    }
    return false
  }

  /**
   * 调用 MCP 工具
   *
   * @param request 工具调用请求
   * @returns 工具调用结果
   */
  async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
    const api = getMcpAPI()
    if (!api?.mcpCallTool) {
      throw new Error('MCP API not available')
    }

    return await api.mcpCallTool(request)
  }

  /**
   * 连接服务器（旧 API，兼容 connect 方法）
   *
   * @param config 服务器配置
   */
  async connect(config: McpServerConfig): Promise<void> {
    this.servers.set(config.name, config)
  }

  /**
   * 断开服务器连接
   *
   * @param name 服务器名称
   */
  async disconnect(name: string): Promise<void> {
    this.servers.delete(name)
    this.serverStates.delete(name)
  }

  /**
   * 列出所有工具
   *
   * @param serverName 服务器名称（可选）
   * @returns 工具列表
   */
  async listTools(serverName?: string): Promise<McpTool[]> {
    if (serverName) {
      const state = this.serverStates.get(serverName)
      return state?.tools || []
    }

    const allTools: McpTool[] = []
    for (const state of this.serverStates.values()) {
      if (state.tools) {
        allTools.push(...state.tools)
      }
    }
    return allTools
  }

  /**
   * 获取已连接的服务器列表
   *
   * @returns 服务器名称列表
   */
  getConnectedServers(): string[] {
    const connected: string[] = []
    for (const [name, state] of this.serverStates) {
      if (state.status === 'connected') {
        connected.push(name)
      }
    }
    return connected.length > 0 ? connected : Array.from(this.servers.keys())
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }
}

/** 全局 MCP 服务实例 */
export const mcpService = new McpService()
