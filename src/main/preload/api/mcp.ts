/**
 * MCP / Skills API
 *
 * 覆盖 IPC 频道：
 * - mcp:*       MCP 服务器生命周期 / 工具调用 / 资源读取 / 注册表
 * - skills:*    全局技能目录
 */
import { invoke, on } from '../ipcHelpers'

export function createMcpApi() {
  return {
    // ── MCP 生命周期 ──
    mcpInitialize: (workspaceRoots: string[]) => invoke('mcp:initialize')(workspaceRoots),
    mcpGetServersState: invoke('mcp:getServersState'),
    mcpGetAllTools: invoke('mcp:getAllTools'),
    mcpConnectServer: (serverId: string) => invoke('mcp:connectServer')(serverId),
    mcpDisconnectServer: (serverId: string) => invoke('mcp:disconnectServer')(serverId),
    mcpReconnectServer: (serverId: string) => invoke('mcp:reconnectServer')(serverId),

    // ── 工具 / 资源 / Prompt ──
    mcpCallTool: (request: {
      serverId: string
      toolName: string
      arguments: Record<string, unknown>
    }) => invoke('mcp:callTool')(request),
    mcpReadResource: (request: { serverId: string; uri: string }) =>
      invoke('mcp:readResource')(request),
    mcpGetPrompt: (request: {
      serverId: string
      promptName: string
      arguments?: Record<string, string>
    }) => invoke('mcp:getPrompt')(request),
    mcpRefreshCapabilities: (serverId: string) =>
      invoke('mcp:refreshCapabilities')(serverId),

    // ── 配置 ──
    mcpGetConfigPaths: invoke('mcp:getConfigPaths'),
    mcpReloadConfig: invoke('mcp:reloadConfig'),
    mcpAddServer: (
      config: {
        type?: 'local' | 'remote'
        id: string
        name: string
        command?: string
        args?: string[]
        env?: Record<string, string>
        url?: string
        headers?: Record<string, string>
        oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
        autoApprove?: string[]
        disabled?: boolean
      },
      level?: 'user' | 'workspace',
    ) => invoke('mcp:addServer')(config, level),
    mcpRemoveServer: (serverId: string, level?: 'user' | 'workspace') =>
      invoke('mcp:removeServer')(serverId, level),
    mcpToggleServer: (serverId: string, disabled: boolean, level?: 'user' | 'workspace') =>
      invoke('mcp:toggleServer')(serverId, disabled, level),
    mcpSetAutoConnect: (enabled: boolean) => invoke('mcp:setAutoConnect')(enabled),

    // ── Registry ──
    mcpRegistrySearch: (query?: string) => invoke('mcp:registrySearch')(query),
    mcpRegistryGetDetails: (serverName: string) =>
      invoke('mcp:registryGetDetails')(serverName),
    mcpRegistryInstall: (serverName: string, envValues?: Record<string, string>) =>
      invoke('mcp:registryInstall')(serverName, envValues),

    // ── OAuth ──
    mcpStartOAuth: (serverId: string) => invoke('mcp:startOAuth')(serverId),
    mcpFinishOAuth: (serverId: string, authorizationCode: string) =>
      invoke('mcp:finishOAuth')(serverId, authorizationCode),
    mcpRefreshOAuthToken: (serverId: string) => invoke('mcp:refreshOAuthToken')(serverId),

    // ── 事件订阅 ──
    onMcpServerStatus: on<{
      serverId: string
      status: string
      error?: string
      authUrl?: string
    }>('mcp:serverStatus'),
    onMcpToolsUpdated: on<{ serverId: string; tools: unknown[] }>('mcp:toolsUpdated'),
    onMcpResourcesUpdated: on<{ serverId: string; resources: unknown[] }>(
      'mcp:resourcesUpdated',
    ),
    onMcpStateChanged: on<unknown[]>('mcp:stateChanged'),

    // ── Skills ──
    skillsGetGlobalDir: invoke<string>('skills:getGlobalDir'),
  }
}
