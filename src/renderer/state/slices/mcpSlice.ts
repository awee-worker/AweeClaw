/**
 * MCP 服务器状态切片
 *
 * 管理 MCP 服务器列表及其工具、资源，提供聚合查询选择器。
 */

import { StateCreator } from 'zustand'
import type {
  McpServerState,
  McpServerStatus,
  McpTool,
  McpResource,
} from '@shared/protocols/toolProtocolBridge'

/** 带服务器来源信息的工具 */
export type SourcedTool = McpTool & { serverId: string; serverName: string }

/** 带服务器来源信息的资源 */
export type SourcedResource = McpResource & { serverId: string; serverName: string }

/** 切片接口 */
export interface McpSlice {
  mcpServers: McpServerState[]
  mcpInitialized: boolean
  mcpLoading: boolean
  mcpError: string | null

  setMcpServers: (servers: McpServerState[]) => void
  setMcpInitialized: (initialized: boolean) => void
  setMcpLoading: (loading: boolean) => void
  setMcpError: (error: string | null) => void
  updateMcpServerStatus: (serverId: string, status: McpServerStatus, error?: string) => void
  updateMcpServerTools: (serverId: string, tools: McpTool[]) => void
  updateMcpServerResources: (serverId: string, resources: McpResource[]) => void

  getMcpServer: (serverId: string) => McpServerState | undefined
  getConnectedMcpServers: () => McpServerState[]
  getAllMcpTools: () => SourcedTool[]
  getAllMcpResources: () => SourcedResource[]
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 更新指定服务器的字段 */
function patchServer(
  servers: McpServerState[],
  serverId: string,
  patch: Partial<McpServerState>,
): McpServerState[] {
  return servers.map((server) => (server.id === serverId ? { ...server, ...patch } : server))
}

/** 从已连接服务器中收集带来源的条目 */
function collectFromConnected<T>(
  servers: McpServerState[],
  selector: (server: McpServerState) => T[],
): Array<T & { serverId: string; serverName: string }> {
  const result: Array<T & { serverId: string; serverName: string }> = []
  for (const server of servers) {
    if (server.status !== 'connected') continue
    for (const item of selector(server)) {
      result.push({ ...item, serverId: server.id, serverName: server.config.name })
    }
  }
  return result
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

export const createMcpSlice: StateCreator<McpSlice, [], [], McpSlice> = (set, get) => ({
  mcpServers: [],
  mcpInitialized: false,
  mcpLoading: false,
  mcpError: null,

  setMcpServers: (servers) => set({ mcpServers: servers }),
  setMcpInitialized: (initialized) => set({ mcpInitialized: initialized }),
  setMcpLoading: (loading) => set({ mcpLoading: loading }),
  setMcpError: (error) => set({ mcpError: error }),

  updateMcpServerStatus: (serverId, status, error) =>
    set((state) => ({ mcpServers: patchServer(state.mcpServers, serverId, { status, error }) })),

  updateMcpServerTools: (serverId, tools) =>
    set((state) => ({ mcpServers: patchServer(state.mcpServers, serverId, { tools }) })),

  updateMcpServerResources: (serverId, resources) =>
    set((state) => ({ mcpServers: patchServer(state.mcpServers, serverId, { resources }) })),

  getMcpServer: (serverId) => get().mcpServers.find((s) => s.id === serverId),

  getConnectedMcpServers: () => get().mcpServers.filter((s) => s.status === 'connected'),

  getAllMcpTools: () => collectFromConnected(get().mcpServers, (s) => s.tools),

  getAllMcpResources: () => collectFromConnected(get().mcpServers, (s) => s.resources),
})
