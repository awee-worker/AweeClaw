/**
 * MCP Service adapter for renderer process
 */
export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class McpService {
  private servers = new Map<string, McpServerConfig>()

  async connect(config: McpServerConfig): Promise<void> {
    this.servers.set(config.name, config)
  }

  async disconnect(name: string): Promise<void> {
    this.servers.delete(name)
  }

  async listTools(_serverName?: string): Promise<McpTool[]> {
    return []
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys())
  }
}

export const mcpService = new McpService()
