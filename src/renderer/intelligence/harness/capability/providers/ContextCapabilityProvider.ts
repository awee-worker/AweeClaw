import type { Capability, CapabilityProvider, CapabilityInput, CapabilityContext, CapabilityOutput } from '../Capability'
import type { IRetrievalService } from '../../kernel/Token'

export class ContextCapabilityProvider implements CapabilityProvider {
  readonly id = 'context'
  readonly name = 'Context Capabilities'
  readonly type = 'context' as const

  private retrievalService: IRetrievalService

  constructor(retrievalService: IRetrievalService) {
    this.retrievalService = retrievalService
  }

  async load(): Promise<Capability[]> {
    return [
      new ContextSearchCapability(this.retrievalService),
    ]
  }
}

class ContextSearchCapability implements Capability {
  readonly id = 'context:search'
  readonly type = 'context' as const
  readonly name = 'context_search'
  readonly description = 'Search workspace context for relevant information'
  readonly version = '1.0.0'
  readonly metadata = { source: 'builtin' }

  constructor(private retrievalService: IRetrievalService) {}

  async invoke(input: CapabilityInput, _ctx: CapabilityContext): Promise<CapabilityOutput> {
    const query = input.args.query as string
    const limit = (input.args.limit as number) ?? 10
    if (!query) {
      return { success: false, error: 'query is required' }
    }
    try {
      const results = await this.retrievalService.search(query, limit)
      return { success: true, data: results }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
