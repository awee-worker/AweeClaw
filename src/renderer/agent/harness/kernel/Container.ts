import { InjectToken } from './Token'

type Factory<T> = (ctx: HarnessContainer) => T

interface Binding<T> {
  factory: Factory<T>
  singleton: boolean
  instance?: T
}

export class HarnessContainer {
  private bindings = new Map<InjectToken<any>, Binding<any>>()
  private resolving = new Set<string>()
  private parent: HarnessContainer | null
  private scopeId: string
  private disposed = false
  private disposables: Array<() => void | Promise<void>> = []

  constructor(parent?: HarnessContainer, scopeId?: string) {
    this.parent = parent ?? null
    this.scopeId = scopeId ?? 'root'
  }

  bind<T>(token: InjectToken<T>, factory: Factory<T>): this {
    this.assertAlive()
    this.bindings.set(token, { factory, singleton: false })
    return this
  }

  singleton<T>(token: InjectToken<T>, factory: Factory<T>): this {
    this.assertAlive()
    this.bindings.set(token, { factory, singleton: true })
    return this
  }

  value<T>(token: InjectToken<T>, value: T): this {
    this.assertAlive()
    this.bindings.set(token, { factory: () => value, singleton: true, instance: value })
    return this
  }

  resolve<T>(token: InjectToken<T>): T {
    this.assertAlive()

    const binding = this.bindings.get(token)
    if (binding) {
      if (binding.singleton && binding.instance !== undefined) {
        return binding.instance as T
      }

      if (this.resolving.has(token.id)) {
        throw new Error(
          `[HarnessContainer] Circular dependency detected while resolving "${token.id}" (${token.description}). ` +
          `Resolution chain: ${Array.from(this.resolving).join(' → ')} → ${token.id}`
        )
      }

      this.resolving.add(token.id)
      try {
        const instance = binding.factory(this)
        if (binding.singleton) {
          binding.instance = instance
        }
        return instance as T
      } finally {
        this.resolving.delete(token.id)
      }
    }

    if (this.parent) {
      return this.parent.resolve(token)
    }

    throw new Error(
      `[HarnessContainer] No binding found for token "${token.id}" (${token.description}). ` +
      `Available tokens: ${Array.from(this.bindings.keys()).map(t => t.id).join(', ')}`
    )
  }

  has<T>(token: InjectToken<T>): boolean {
    if (this.bindings.has(token)) return true
    if (this.parent) return this.parent.has(token)
    return false
  }

  createScope(scopeId: string): HarnessContainer {
    this.assertAlive()
    const child = new HarnessContainer(this, `${this.scopeId}/${scopeId}`)
    return child
  }

  onDispose(callback: () => void | Promise<void>): void {
    this.disposables.push(callback)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    for (const cb of this.disposables) {
      try {
        await cb()
      } catch {
        // swallow disposal errors
      }
    }
    this.disposables.length = 0

    for (const [, binding] of this.bindings) {
      if (binding.singleton && binding.instance && typeof binding.instance === 'object' && binding.instance !== null) {
        const inst = binding.instance as Record<string, unknown>
        if (typeof inst.dispose === 'function') {
          try {
            await (inst.dispose as () => Promise<void>)()
          } catch {
            // swallow
          }
        }
      }
    }

    this.bindings.clear()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get id(): string {
    return this.scopeId
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error(`[HarnessContainer] Container "${this.scopeId}" has been disposed and can no longer be used.`)
    }
  }
}
