import { logger } from '@utils/Logger'
import type { Capability, CapabilityFilter, CapabilityProvider, CapabilityInput, CapabilityContext, CapabilityOutput } from './Capability'

export class CapabilityRegistry {
  private capabilities = new Map<string, Capability>()
  private providers = new Map<string, CapabilityProvider>()
  private listeners = new Set<CapabilityRegistryListener>()

  register(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      logger.agent.warn(`[CapabilityRegistry] Overwriting existing capability: ${capability.id}`)
    }
    this.capabilities.set(capability.id, capability)
    this.notifyListeners('register', capability)
  }

  unregister(id: string): boolean {
    const capability = this.capabilities.get(id)
    if (!capability) return false
    this.capabilities.delete(id)
    this.notifyListeners('unregister', capability)
    return true
  }

  resolve(id: string): Capability | undefined {
    return this.capabilities.get(id)
  }

  resolveByName(name: string): Capability | undefined {
    for (const cap of this.capabilities.values()) {
      if (cap.name === name) return cap
    }
    return undefined
  }

  query(filter: CapabilityFilter): Capability[] {
    let results = Array.from(this.capabilities.values())

    if (filter.type) {
      results = results.filter(c => c.type === filter.type)
    }

    if (filter.types && filter.types.length > 0) {
      const typeSet = new Set(filter.types)
      results = results.filter(c => typeSet.has(c.type))
    }

    if (filter.namePrefix) {
      results = results.filter(c => c.name.startsWith(filter.namePrefix!))
    }

    if (filter.metadata) {
      results = results.filter(c => {
        for (const [key, value] of Object.entries(filter.metadata!)) {
          if (c.metadata[key] !== value) return false
        }
        return true
      })
    }

    if (filter.custom) {
      results = results.filter(filter.custom)
    }

    return results
  }

  getAll(): Capability[] {
    return Array.from(this.capabilities.values())
  }

  getTypes(): string[] {
    const types = new Set<string>()
    for (const cap of this.capabilities.values()) {
      types.add(cap.type)
    }
    return Array.from(types)
  }

  async loadProvider(provider: CapabilityProvider): Promise<void> {
    if (this.providers.has(provider.id)) {
      logger.agent.warn(`[CapabilityRegistry] Provider ${provider.id} already loaded, reloading...`)
      await this.unloadProvider(provider.id)
    }

    this.providers.set(provider.id, provider)
    const capabilities = await provider.load()

    for (const cap of capabilities) {
      this.register(cap)
    }

    logger.agent.info(
      `[CapabilityRegistry] Loaded provider "${provider.name}" (${provider.id}): ` +
      `${capabilities.length} capabilities registered`
    )
  }

  async unloadProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId)
    if (!provider) return

    for (const [id, cap] of this.capabilities.entries()) {
      if (cap.type === provider.type) {
        this.unregister(id)
      }
    }

    if (provider.dispose) {
      await provider.dispose()
    }
    this.providers.delete(providerId)
  }

  async invoke(id: string, input: CapabilityInput, ctx: CapabilityContext): Promise<CapabilityOutput> {
    const capability = this.capabilities.get(id)
    if (!capability) {
      return { success: false, error: `Capability not found: ${id}` }
    }
    return capability.invoke(input, ctx)
  }

  addListener(listener: CapabilityRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(event: 'register' | 'unregister', capability: Capability): void {
    for (const listener of this.listeners) {
      try {
        listener(event, capability)
      } catch {
        // swallow listener errors
      }
    }
  }

  get size(): number {
    return this.capabilities.size
  }
}

export type CapabilityRegistryListener = (event: 'register' | 'unregister', capability: Capability) => void
