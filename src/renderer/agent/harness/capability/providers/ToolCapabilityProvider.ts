import type { Capability, CapabilityProvider, CapabilityInput, CapabilityContext, CapabilityOutput } from '../Capability'
import type { IToolManager } from '../../kernel/Token'

export class ToolCapabilityProvider implements CapabilityProvider {
  readonly id = 'builtin-tools'
  readonly name = 'Built-in Tool Capabilities'
  readonly type = 'tool' as const

  private toolManager: IToolManager

  constructor(toolManager: IToolManager) {
    this.toolManager = toolManager
  }

  async load(): Promise<Capability[]> {
    const definitions = this.toolManager.getToolDefinitions()
    const capabilities: Capability[] = []

    for (const def of definitions) {
      const toolDef = def as { name: string; description?: string }
      capabilities.push(new ToolCapability(toolDef.name, toolDef.description ?? '', this.toolManager))
    }

    return capabilities
  }
}

class ToolCapability implements Capability {
  readonly id: string
  readonly type = 'tool' as const
  readonly name: string
  readonly description: string
  readonly version = '1.0.0'
  readonly metadata: Record<string, unknown>

  constructor(
    name: string,
    description: string,
    private toolManager: IToolManager
  ) {
    this.id = `tool:${name}`
    this.name = name
    this.description = description
    this.metadata = { source: 'builtin' }
  }

  async invoke(input: CapabilityInput, ctx: CapabilityContext): Promise<CapabilityOutput> {
    try {
      const result = await this.toolManager.execute(this.name, input.args, ctx)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
