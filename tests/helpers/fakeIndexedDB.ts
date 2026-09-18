/**
 * 极简内存版 IndexedDB —— 仅供单元测试使用
 *
 * 背景：主进程/渲染层多个模块（SubAgentEngine、OfflineModeService、localVectorIndex 等）
 * 直接依赖浏览器 IndexedDB。vitest 的 environment 是 node，全局没有 indexedDB，
 * 相关测试要么崩在 import 期，要么拿到一个不兼容的 stub（例如把 open() 写成
 * Promise，而代码用的是 request.onsuccess 回调风格）——后者会让 this.db 一直是 null，
 * 表现出来就是满屏 "DB not initialized"。
 *
 * 这里实现「回调风格」的最小可用子集，覆盖项目实际用到的 API：
 *   open / onupgradeneeded / onsuccess / onerror / result
 *   db.objectStoreNames.contains / createObjectStore / transaction
 *   store.put / get / getAll / delete / clear / count / createIndex / index
 *   index.get / getAll
 *
 * 请求回调统一在微任务里触发，保证「先 open() 后挂 onsuccess」的写法能拿到回调；
 * 事务的 oncomplete 用宏任务触发，确保排在请求回调之后（贴近真实时序）。
 */

type Handler = ((ev: any) => void) | null

/** 按 keyPath 从对象里取值（支持 "a.b" 形式） */
function getByPath(target: any, keyPath: string): any {
  return keyPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), target)
}

class FakeRequest<T = any> {
  result: T = undefined as any
  error: Error | null = null
  readyState: 'pending' | 'done' = 'pending'

  onsuccess: Handler = null
  onerror: Handler = null
  onupgradeneeded: Handler = null

  private readonly listeners = new Map<string, Set<(ev: any) => void>>()

  addEventListener(type: string, fn: (ev: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: (ev: any) => void): void {
    this.listeners.get(type)?.delete(fn)
  }

  private handlerFor(type: string): Handler {
    if (type === 'success') return this.onsuccess
    if (type === 'error') return this.onerror
    if (type === 'upgradeneeded') return this.onupgradeneeded
    return null
  }

  _emit(type: string): void {
    const ev = { type, target: this, currentTarget: this }
    this.handlerFor(type)?.(ev)
    this.listeners.get(type)?.forEach((fn) => fn(ev))
  }

  _succeed(result: T): void {
    this.result = result
    this.readyState = 'done'
    this._emit('success')
  }

  _fail(error: Error): void {
    this.error = error
    this.readyState = 'done'
    this._emit('error')
  }
}

class FakeIndex {
  constructor(
    private readonly store: FakeObjectStore,
    private readonly name: string,
  ) {}

  private get keyPath(): string {
    const meta = this.store.indexes.get(this.name)
    if (!meta) throw new Error(`Index not found: ${this.name}`)
    return meta.keyPath
  }

  private matches(range: any): any[] {
    const keyPath = this.keyPath
    const all = [...this.store.data.values()]
    if (range === undefined) return all
    return all.filter((item) => getByPath(item, keyPath) === range)
  }

  get(key: any): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => {
      const hit = this.matches(undefined).find((item) => getByPath(item, this.keyPath) === key)
      request._succeed(hit)
    })
    return request
  }

  getAll(range?: any): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => request._succeed(this.matches(range)))
    return request
  }

  count(): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => request._succeed(this.matches(undefined).length))
    return request
  }
}

class FakeObjectStore {
  readonly data = new Map<any, any>()
  readonly indexes = new Map<string, { keyPath: string }>()
  readonly keyPath: string | null

  constructor(
    readonly name: string,
    options?: { keyPath?: string | string[] },
  ) {
    this.keyPath = typeof options?.keyPath === 'string' ? options.keyPath : null
  }

  createIndex(name: string, keyPath: string): { name: string; keyPath: string } {
    this.indexes.set(name, { keyPath })
    return { name, keyPath }
  }

  index(name: string): FakeIndex {
    return new FakeIndex(this, name)
  }

  private resolveKey(value: any, explicitKey?: any): any {
    if (explicitKey !== undefined) return explicitKey
    if (!this.keyPath) return undefined
    return getByPath(value, this.keyPath)
  }

  put(value: any, explicitKey?: any): FakeRequest {
    const request = new FakeRequest()
    const key = this.resolveKey(value, explicitKey)
    if (key === undefined) {
      queueMicrotask(() => request._fail(new Error('FakeIndexedDB: keyPath value is missing')))
      return request
    }
    this.data.set(key, value)
    queueMicrotask(() => request._succeed(key))
    return request
  }

  get(key: any): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => request._succeed(this.data.get(key)))
    return request
  }

  getAll(): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => request._succeed([...this.data.values()]))
    return request
  }

  delete(key: any): FakeRequest {
    const request = new FakeRequest()
    this.data.delete(key)
    queueMicrotask(() => request._succeed(undefined))
    return request
  }

  clear(): FakeRequest {
    const request = new FakeRequest()
    this.data.clear()
    queueMicrotask(() => request._succeed(undefined))
    return request
  }

  count(): FakeRequest {
    const request = new FakeRequest()
    queueMicrotask(() => request._succeed(this.data.size))
    return request
  }
}

class FakeTransaction {
  oncomplete: Handler = null
  onerror: Handler = null
  onabort: Handler = null

  constructor(
    private readonly db: FakeDatabase,
    readonly mode: string,
  ) {
    // 用宏任务触发，保证排在本次事务内请求回调之后
    setTimeout(() => this.oncomplete?.({ type: 'complete', target: this }), 0)
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.db.stores.get(name)
    if (!store) throw new Error(`FakeIndexedDB: object store not found: ${name}`)
    return store
  }

  abort(): void {
    this.onabort?.({ type: 'abort', target: this })
  }
}

/**
 * DOMStringList 的最小子集（源码只用到 contains）
 *
 * 只接收 stores 映射，而不是整个 FakeDatabase —— 否则与 FakeDatabase 形成
 * 循环类型依赖（FakeDatabase → FakeObjectStoreNames → FakeDatabase），
 * TS 无法收敛会回退成匿名结构类型，导致 this.db.stores 报 TS2339。
 */
class FakeObjectStoreNames {
  constructor(private readonly stores: Map<string, FakeObjectStore>) {}

  contains(name: string): boolean {
    return this.stores.has(name)
  }

  get length(): number {
    return this.stores.size
  }

  item(index: number): string | null {
    return [...this.stores.keys()][index] ?? null
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.stores.keys()
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeObjectStore>()

  readonly objectStoreNames: FakeObjectStoreNames = new FakeObjectStoreNames(this.stores)

  createObjectStore(name: string, options?: { keyPath?: string | string[] }): FakeObjectStore {
    const store = new FakeObjectStore(name, options)
    this.stores.set(name, store)
    return store
  }

  transaction(names: string | string[], mode = 'readonly'): FakeTransaction {
    const list = Array.isArray(names) ? names : [names]
    for (const name of list) {
      if (!this.stores.has(name)) {
        throw new Error(`FakeIndexedDB: object store not found: ${name}`)
      }
    }
    return new FakeTransaction(this, mode)
  }

  close(): void {
    /* no-op */
  }
}

class FakeIDBFactory {
  private readonly databases = new Map<string, { db: FakeDatabase; version: number }>()

  open(name: string, version = 1): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>()

    queueMicrotask(() => {
      let entry = this.databases.get(name)
      const isNew = !entry
      if (!entry) {
        entry = { db: new FakeDatabase(), version }
        this.databases.set(name, entry)
      }

      const needsUpgrade = isNew || version > entry.version
      if (needsUpgrade) {
        entry.version = Math.max(version, entry.version)
        request.result = entry.db
        request._emit('upgradeneeded')
      }

      queueMicrotask(() => request._succeed(entry!.db))
    })

    return request
  }

  deleteDatabase(name: string): FakeRequest {
    const request = new FakeRequest()
    this.databases.delete(name)
    queueMicrotask(() => request._succeed(undefined))
    return request
  }

  databases_(): string[] {
    return [...this.databases.keys()]
  }

  reset(): void {
    this.databases.clear()
  }
}

let factory: FakeIDBFactory | null = null

/** 把内存版 IndexedDB 安装到全局（幂等） */
export function installFakeIndexedDB(): FakeIDBFactory {
  if (!factory) factory = new FakeIDBFactory()
  ;(globalThis as any).indexedDB = factory
  ;(globalThis as any).IDBDatabase = FakeDatabase
  ;(globalThis as any).IDBObjectStore = FakeObjectStore
  return factory
}

/** 清空所有测试数据库（测试之间隔离用） */
export function resetFakeIndexedDB(): void {
  factory?.reset()
}
