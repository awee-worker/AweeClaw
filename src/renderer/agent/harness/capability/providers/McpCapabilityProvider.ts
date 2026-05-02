import type { Capability, CapabilityProvider, CapabilityInput, CapabilityContext, CapabilityOutput } from '../Capability'

export class McpCapabilityProvider implements CapabilityProvider {
  readonly id = 'mcp'
  readonly name = 'MCP Tool Capabilities'
  readonly type = 'mcp' as const

  private mcpExecute: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>

  constructor(mcpExecute: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>) {
    this.mcpExecute = mcpExecute
  }

  async load(): Promise<Capability[]> {
    return []
  }

  registerMcpTool(serverId: string, toolName: string, description: string): Capability {
    const capability = new McpToolCapability(serverId, toolName, description, this.mcpExecute)
    return capability
  }
}

class McpToolCapability implements Capability {
  readonly id: string
  readonly type = 'mcp' as const
  readonly name: string
  readonly description: string
  readonly version = '1.0.0'
  readonly metadata: Record<string, unknown>

  constructor(
    private serverId: string,
    toolName: string,
    description: string,
    private mcpExecute: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
  ) {
    this.id = `mcp:${serverId}__${toolName}`
    this.name = `mcp_${serverId}__${toolName}`
    this.description = description
    this.metadata = { source: 'mcp', serverId }
  }

  async invoke(input: CapabilityInput, _ctx: CapabilityContext): Promise<CapabilityOutput> {
    try {
      const toolName = this.name.replace(`mcp_${this.serverId}__`, '')
      const result = await this.mcpExecute(this.serverId, toolName, input.args)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
