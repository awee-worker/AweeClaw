/**
 * MCP 服务管理器
 * 统一管理所有 MCP 服务器的生命周期
 */

import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { safeOpenExternal } from '../../guard/safeExternalUrl'
import { McpClient } from './ToolProtocolClient'
import { McpConfigLoader } from './ToolConfigLoader'
import { McpOAuthCallback } from './ToolOAuthCallback'
import { McpAuthStore } from './ToolAuthVault'
import {
  type McpServerConfig,
  type McpLocalServerConfig,
  type McpServerState,
  type McpTool,
  type McpResource,
  type McpToolCallResult,
  type McpResourceReadResult,
  type McpPromptGetResult,
  type McpPluginServerConfig,
  isLocalConfig,
} from '@shared/protocols/toolProtocolBridge'

export class McpManager extends EventEmitter {
  private clients = new Map<string, McpClient>()
  private configLoader: McpConfigLoader
  private initialized = false
  private autoConnectEnabled = true
  private workspaceRoots: string[] = []
  private cachedConfigs: McpServerConfig[] | null = null

  constructor() {
    super()
    this.configLoader = new McpConfigLoader()
    this.configLoader.setOnConfigChange(() => this.handleConfigChange())
  }

  /** 设置是否启用自动连接 */
  setAutoConnectEnabled(enabled: boolean): void {
    this.autoConnectEnabled = enabled
    logger.mcp?.info(`[McpManager] Auto-connect ${enabled ? 'enabled' : 'disabled'}`)
    if (enabled && this.initialized) {
      this.autoConnectServers()
    }
  }

  /** 获取当前工作区根目录（用于 MCP 插件子进程的 cwd） */
  getWorkspaceRoot(): string | null {
    return this.workspaceRoots.length > 0 ? this.workspaceRoots[0] : null
  }

  /** 初始化 MCP 管理器 */
  async initialize(workspaceRoots: string[] = []): Promise<void> {
    const rootsChanged = JSON.stringify(this.workspaceRoots) !== JSON.stringify(workspaceRoots)
    this.workspaceRoots = workspaceRoots

    if (this.initialized) {
      this.configLoader.setWorkspaceRoots(workspaceRoots)
      this.notifyStateChange()

      if (rootsChanged) {
        this.reconnectDynamicArgServers()
      }

      this.autoConnectServers()
      return
    }

    logger.mcp?.info('[McpManager] Initializing...')
    this.configLoader.setWorkspaceRoots(workspaceRoots)
    this.notifyStateChange()
    this.initialized = true
    logger.mcp?.info('[McpManager] Initialized')

    this.autoConnectServers()
  }

  /** 异步后台自动连接所有未禁用的服务器 */
  private async autoConnectServers(): Promise<void> {
    // 检查是否启用自动连接
    if (!this.autoConnectEnabled) {
      logger.mcp?.info('[McpManager] Auto-connect is disabled, skipping')
      return
    }

    const configs = await this.configLoader.loadConfig()
    this.cachedConfigs = configs
    const enabledConfigs = configs.filter((c) => !c.disabled)

    if (enabledConfigs.length === 0) {
      logger.mcp?.info('[McpManager] No enabled servers to auto-connect')
      return
    }

    logger.mcp?.info(`[McpManager] Auto-connecting ${enabledConfigs.length} server(s) in background...`)

    // 异步并行连接所有服务器，不阻塞主流程
    Promise.all(
      enabledConfigs.map(async (config) => {
        try {
          // 跳过已连接的服务器
          if (this.clients.has(config.id)) {
            return
          }
          await this.connectServer(config)
          logger.mcp?.info(`[McpManager] Auto-connected: ${config.id}`)
        } catch (err) {
          const originalMsg = err instanceof Error ? err.message : String(err)
          logger.mcp?.warn(`[McpManager] Auto-connect failed for ${config.id}: ${originalMsg}`, err)
        }
      })
    ).then(() => {
      logger.mcp?.info('[McpManager] Auto-connect completed')
    }).catch((err) => {
      logger.mcp?.error('[McpManager] Auto-connect error:', err)
    })
  }

  /** 重新加载配置 */
  async reloadConfig(): Promise<void> {
    const configs = await this.configLoader.loadConfig()
    this.cachedConfigs = configs
    const currentIds = new Set(this.clients.keys())
    const newIds = new Set(configs.map((c) => c.id))

    // 断开已移除的服务器
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        await this.disconnectServer(id)
      }
    }

    // 断开被禁用的服务器
    for (const config of configs) {
      if (config.disabled && this.clients.has(config.id)) {
        await this.disconnectServer(config.id)
      }
    }

    this.notifyStateChange()

    // 自动连接新添加或重新启用的服务器
    this.autoConnectServers()
  }

  /** 连接服务器 */
  async connectServer(configOrId: McpServerConfig | string): Promise<void> {
    let config: McpServerConfig
    if (typeof configOrId === 'string') {
      const configs = await this.configLoader.loadConfig()
      const found = configs.find((c) => c.id === configOrId)
      if (!found) {
        logger.mcp?.error(`[McpManager] Server config not found: ${configOrId}`)
        return
      }
      if (found.disabled) {
        logger.mcp?.warn(`[McpManager] Server ${configOrId} is disabled`)
        return
      }
      config = found
    } else {
      config = configOrId
    }

    if (this.clients.has(config.id)) {
      const existing = this.clients.get(config.id)!
      if (existing.status === 'error') {
        await this.disconnectServer(config.id)
      } else {
        logger.mcp?.warn(`[McpManager] Server ${config.id} already connected`)
        return
      }
    }

    const processedConfig = this.injectDynamicArgs(config)

    const client = new McpClient(processedConfig)

    // 监听事件
    client.on('statusChanged', ({ status, error, authUrl }) => {
      this.sendToRenderer('mcp:serverStatus', { serverId: config.id, status, error, authUrl })
    })

    client.on('toolsUpdated', (tools: McpTool[]) => {
      this.sendToRenderer('mcp:toolsUpdated', { serverId: config.id, tools })
    })

    client.on('resourcesUpdated', (resources: McpResource[]) => {
      this.sendToRenderer('mcp:resourcesUpdated', { serverId: config.id, resources })
    })

    client.on('disconnected', () => {
      this.clients.delete(config.id)
      this.notifyStateChange()
    })

    this.clients.set(config.id, client)

    try {
      await client.connect()
    } catch (err) {
      // 保留原始错误消息用于诊断和展示
      // 不使用 toAppError 转换，因为 errorCatalog 的关键词匹配会把 stderr 中的
      // "network"、"fetch"、"terminated" 等词误判为 NETWORK_ERROR，显示 "Network error"
      // 而真正的错误原因（如 ENOENT、Timeout、uvx 未找到等）被掩盖
      const originalMsg = err instanceof Error ? err.message : String(err)
      const errorCode = (err as NodeJS.ErrnoException)?.code || ''
      logger.mcp?.error(`[McpManager] Failed to connect ${config.id}: ${errorCode || 'unknown'}`, err)
      // 直接使用原始错误消息展示给用户，保留完整的诊断信息（包括 stderr）
      await client.forceCleanupAndSetError(originalMsg).catch(() => { })
    }

    this.notifyStateChange()
  }

  /** 断开服务器 */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (!client) return

    await client.disconnect()
    this.clients.delete(serverId)
    this.notifyStateChange()
  }

  /** 重连服务器 */
  async reconnectServer(serverId: string): Promise<void> {
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    await this.connectServer(serverId)
  }

  /** 获取所有服务器状态（使用缓存配置，避免频繁读取文件） */
  async getServersState(): Promise<McpServerState[]> {
    if (!this.cachedConfigs) {
      this.cachedConfigs = await this.configLoader.loadConfig()
    }
    const configs = this.cachedConfigs
    const states: McpServerState[] = []

    for (const config of configs) {
      const client = this.clients.get(config.id)
      const state: McpServerState = {
        id: config.id,
        config,
        status: client?.status || 'disconnected',
        error: client?.error,
        tools: client?.tools || [],
        resources: client?.resources || [],
        prompts: client?.prompts || [],
      }

      if (client) {
        state.authUrl = client.authUrl
        const tokens = client.getTokens()
        if (tokens) {
          state.authStatus = client.isTokenExpired() ? 'expired' : 'authenticated'
        } else if (client.status === 'needs_auth') {
          state.authStatus = 'not_authenticated'
        }
      }

      states.push(state)
    }

    return states
  }

  /** 获取所有可用工具 */
  getAllTools(): Array<McpTool & { serverId: string }> {
    const tools: Array<McpTool & { serverId: string }> = []

    for (const [serverId, client] of this.clients) {
      if (client.status === 'connected') {
        for (const tool of client.tools) {
          tools.push({ ...tool, serverId })
        }
      }
    }

    return tools
  }

  /** 调用工具 */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    if (client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} is not connected` }
    }

    try {
      const result = await client.callTool(toolName, args)
      // 工具内部返回 isError 时，从 content 提取错误文本到 error 字段，
      // 避免渲染进程丢失具体错误原因（ComputerUseMcpServer 工具错误信息存放在 content[0].text）
      let errorMessage: string | undefined
      if (result.isError && result.content) {
        errorMessage = result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n') || undefined
      }
      return {
        success: !result.isError,
        content: result.content,
        isError: result.isError,
        error: errorMessage,
      }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
    }
  }

  /** 读取资源 */
  async readResource(serverId: string, uri: string): Promise<McpResourceReadResult> {
    const client = this.clients.get(serverId)
    if (!client || client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} not available` }
    }

    try {
      const result = await client.readResource(uri)
      return { success: true, contents: result.contents }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
    }
  }

  /** 获取提示 */
  async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<McpPromptGetResult> {
    const client = this.clients.get(serverId)
    if (!client || client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} not available` }
    }

    try {
      const result = await client.getPrompt(promptName, args)
      return { success: true, description: result.description, messages: result.messages }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
    }
  }

  /** 刷新服务器能力 */
  async refreshServerCapabilities(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client && client.status === 'connected') {
      await client.refreshCapabilities()
      this.notifyStateChange()
    }
  }

  /** 添加服务器 */
  async addServer(config: McpServerConfig, level: 'user' | 'workspace' = 'user'): Promise<void> {
    await this.configLoader.addServer(config, level)
    logger.mcp?.info(`[McpManager] Added server: ${config.id} (${level})`)
  }

  /**
   * 注册内置插件 MCP 配置（供随应用打包的插件调用，如 computer-use）。
   * 注册后 loadConfig 会自动注入该配置，无需写入用户配置文件。
   * 若 autoConnect 为 true，注册后立即连接。
   */
  async registerBuiltinPluginConfig(config: McpPluginServerConfig, autoConnect = true): Promise<void> {
    this.configLoader.registerBuiltinPluginConfig(config)
    if (autoConnect && !config.disabled) {
      await this.connectServer(config).catch((err) => {
        logger.mcp?.warn(`[McpManager] Builtin plugin auto-connect failed for ${config.id}: ${err}`)
      })
    }
  }

  /** 注销内置插件 MCP 配置并断开连接 */
  async unregisterBuiltinPluginConfig(serverId: string): Promise<void> {
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    this.configLoader.unregisterBuiltinPluginConfig(serverId)
    logger.mcp?.info(`[McpManager] Unregistered builtin plugin: ${serverId}`)
  }

  /** 删除服务器 */
  async removeServer(serverId: string, level: 'user' | 'workspace' = 'user'): Promise<void> {
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    await this.configLoader.removeServer(serverId, level)
    logger.mcp?.info(`[McpManager] Removed server: ${serverId} (${level})`)
  }

  /** 切换服务器启用/禁用 */
  async toggleServer(serverId: string, disabled: boolean, level: 'user' | 'workspace' = 'user'): Promise<void> {
    await this.configLoader.toggleServer(serverId, disabled, level)
    if (disabled && this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    logger.mcp?.info(`[McpManager] Toggled server ${serverId}: disabled=${disabled} (${level})`)
  }

  /** 获取配置路径 */
  getConfigPaths(): { user: string; workspace: string[] } {
    return {
      user: this.configLoader.getUserConfigPath(),
      workspace: this.configLoader.getWorkspaceRoots().map((root) => this.configLoader.getWorkspaceConfigPath(root)),
    }
  }

  // =================== OAuth 方法 ===================

  /** 开始 OAuth 认证 */
  async startOAuth(serverId: string): Promise<{ success: boolean; authorizationUrl?: string; error?: string }> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    const authUrl = client.authUrl
    if (!authUrl) {
      return { success: false, error: 'No authorization URL available' }
    }

    // 启动回调服务器
    await McpOAuthCallback.ensureRunning()

    // 打开浏览器
    try {
      await safeOpenExternal(authUrl)
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: `Failed to open browser: ${error.message}` }
    }

    // 通知渲染进程：OAuth 等待中（使用 connecting 状态复用现有 UI）
    this.sendToRenderer('mcp:serverStatus', {
      serverId,
      status: 'connecting',
      oauthPending: true,
    })

    // 从 AuthStore 取回 OAuth state，自动监听回调并完成授权
    McpAuthStore.get(serverId).then((authEntry) => {
      const oauthState = authEntry?.oauthState
      if (!oauthState) {
        logger.mcp?.warn(`[McpManager] No OAuth state found for ${serverId}, cannot auto-complete`)
        return
      }

      logger.mcp?.info(`[McpManager] Waiting for OAuth callback for ${serverId}...`)
      McpOAuthCallback.waitForCallback(oauthState)
        .then(async (code) => {
          logger.mcp?.info(`[McpManager] OAuth callback received for ${serverId}, completing auth...`)
          const result = await this.finishOAuth(serverId, code)
          if (!result.success) {
            this.sendToRenderer('mcp:serverStatus', { serverId, status: 'error', error: result.error })
          }
        })
        .catch((err: Error) => {
          const cancelled = err.message === 'Authorization cancelled' || err.message === 'OAuth callback server stopped'
          if (!cancelled) {
            logger.mcp?.error(`[McpManager] OAuth failed for ${serverId}: ${err.message}`)
            this.sendToRenderer('mcp:serverStatus', { serverId, status: 'error', error: `OAuth failed: ${err.message}` })
          }
        })
    }).catch((err) => {
      logger.mcp?.error(`[McpManager] Failed to load auth store for ${serverId}:`, err)
    })

    return { success: true, authorizationUrl: authUrl }
  }

  /** 完成 OAuth 认证 */
  async finishOAuth(serverId: string, authorizationCode: string): Promise<{ success: boolean; error?: string }> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    try {
      await client.finishAuth(authorizationCode)
      await McpAuthStore.clearCodeVerifier(serverId)

      // 重新连接
      await this.reconnectServer(serverId)
      return { success: true }
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpManager] OAuth finish failed for ${serverId}: ${error.code}`, error)
      return { success: false, error: error.message }
    }
  }

  /** 刷新 OAuth token */
  async refreshOAuthToken(serverId: string): Promise<{ success: boolean; error?: string }> {
    // SDK 会自动处理 token 刷新
    await this.reconnectServer(serverId)
    return { success: true }
  }

  /** 清理资源 */
  async cleanup(): Promise<void> {
    logger.mcp?.info('[McpManager] Cleaning up...')

    for (const [, client] of this.clients) {
      await client.disconnect()
    }
    this.clients.clear()

    await McpOAuthCallback.stop()
    this.configLoader.cleanup()
    this.initialized = false

    logger.mcp?.info('[McpManager] Cleaned up')
  }

  // =================== 私有方法 ===================

  private handleConfigChange(): void {
    if (!this.initialized) return
    this.cachedConfigs = null // 清除缓存，强制重新加载
    logger.mcp?.info('[McpManager] Config changed, reloading...')
    this.reloadConfig().catch((err) => {
      logger.mcp?.error('[McpManager] Failed to reload config:', err)
    })
  }

  private reconnectDynamicArgServers(): void {
    for (const [id, client] of this.clients) {
      const config = client.config
      if (!isLocalConfig(config)) continue

      const argsStr = (config.args || []).join(' ')
      const isPlaywrightMcp = argsStr.includes('@playwright/mcp') || argsStr.includes('playwright-mcp')
      if (!isPlaywrightMcp) continue

      logger.mcp?.info(`[McpManager] Reconnecting Playwright MCP (${id}) due to workspace change`)
      this.reconnectServer(id).catch((err) => {
        logger.mcp?.warn(`[McpManager] Failed to reconnect ${id}:`, err)
      })
    }
  }

  private injectDynamicArgs(config: McpServerConfig): McpServerConfig {
    if (!isLocalConfig(config)) return config

    const args = [...(config.args || [])]
    const argsStr = args.join(' ')
    const isPlaywrightMcp = argsStr.includes('@playwright/mcp') || argsStr.includes('playwright-mcp')

    if (isPlaywrightMcp) {
      const workspaceDir = this.workspaceRoots.length > 0 ? this.workspaceRoots[0] : ''
      if (workspaceDir) {
        if (!argsStr.includes('--output-dir')) {
          const insertIdx = args.findIndex(a => a.startsWith('@playwright/mcp') || a.includes('playwright-mcp'))
          if (insertIdx !== -1) {
            args.splice(insertIdx + 1, 0, '--output-dir', workspaceDir)
          } else {
            args.push('--output-dir', workspaceDir)
          }
        }
        const result: McpLocalServerConfig = { ...config, args, cwd: workspaceDir }
        logger.mcp?.info(`[McpManager] Injected --output-dir=${workspaceDir} and cwd=${workspaceDir} for Playwright MCP`)
        return result
      }
    }

    return { ...config, args }
  }

  private async notifyStateChange(): Promise<void> {
    const state = await this.getServersState()
    this.sendToRenderer('mcp:stateChanged', state)
  }

  private sendToRenderer(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(channel, data)
        } catch {
          // ignore
        }
      }
    })
  }
}

export const mcpManager = new McpManager()
