export type CapabilityType = 'tool' | 'skill' | 'context' | 'mcp' | 'workflow' | 'service'

export interface CapabilityInput {
  args: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface CapabilityOutput {
  success: boolean
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

export interface CapabilityContext {
  threadId?: string
  workspacePath?: string
  abortSignal?: AbortSignal
  userId?: string
  [key: string]: unknown
}

export interface Capability {
  readonly id: string
  readonly type: CapabilityType
  readonly name: string
  readonly description: string
  readonly version: string
  readonly metadata: Record<string, unknown>
  invoke(input: CapabilityInput, ctx: CapabilityContext): Promise<CapabilityOutput>
  dispose?(): Promise<void>
}

export interface CapabilityFilter {
  type?: CapabilityType
  types?: CapabilityType[]
  namePrefix?: string
  metadata?: Record<string, unknown>
  custom?: (capability: Capability) => boolean
}

export interface CapabilityProvider {
  readonly id: string
  readonly name: string
  readonly type: CapabilityType
  load(): Promise<Capability[]>
  dispose?(): Promise<void>
}
