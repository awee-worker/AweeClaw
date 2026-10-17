/**
 * LanceDB 子进程代理 — 主进程侧薄封装（utilityProcess 隔离 + 内联回退）
 *
 * 职责：
 * - 将 LanceDB 操作以 RPC 派发给 lancedb.worker 子进程，native 模块
 *   （@lancedb/lancedb / apache-arrow）不再加载进主进程
 * - 对调用方返回与原 LanceDB API 同形的连接/表/查询构建器对象，
 *   各 Store 只需把 `await import('@lancedb/lancedb')` 的连接获取
 *   换成 `lancedbProxy.connect(path)`，其余代码零改动
 * - 子进程 fork 失败 / 崩溃超限时回退主进程内联动态 import
 *
 * 注意：回退路径会在主进程加载 native 模块，仅作为子进程持续不可用时兜底。
 */

import { utilityProcess } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import type { LanceDbRequest, LanceDbResponse } from './lancedbTypes'

/** 单操作超时 */
const OP_TIMEOUT_MS = 30_000

const MAX_RESTARTS = 3

interface PendingOp {
  resolve: (res: LanceDbResponse) => void
  timer: NodeJS.Timeout
}

/** 联合类型的分布式 Omit（保留各分支的可辨识字段） */
type RequestBody = LanceDbRequest extends infer T
  ? T extends { id: number } ? Omit<T, 'id'> : never
  : never

/** 查询构建器接口（与各 Store 内声明的 LanceDbQuery/LanceDbVectorQuery 同形） */
export interface ProxyQueryBuilder {
  select(columns: string[]): ProxyQueryBuilder
  where(filter: string): ProxyQueryBuilder
  limit(n: number): ProxyQueryBuilder
  orderBy(column: string, direction: 'ASC' | 'DESC'): ProxyQueryBuilder
  toArray(): Promise<Record<string, unknown>[]>
  /** 流式遍历：跨进程不做真流，取回后本地迭代 */
  execute(): AsyncGenerator<Record<string, unknown>>
}

/** 代理表对象（与各 Store 内声明的 LanceDbTable 同形） */
export interface ProxyTable {
  countRows(): Promise<number>
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  query(): ProxyQueryBuilder
  search(vector: number[]): ProxyQueryBuilder
}

/** 代理连接对象（与各 Store 内声明的 LanceDbConnection 同形） */
export interface ProxyConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<ProxyTable>
  createTable(name: string, data: unknown[]): Promise<ProxyTable>
  dropTable(name: string): Promise<void>
}

class LanceDbProxyImpl {
  private child: Electron.UtilityProcess | null = null
  private pending = new Map<number, PendingOp>()
  private nextId = 1
  private restarts = 0
  private spawnFailed = false
  /** 子进程句柄计数器（与子进程侧自增句柄一一对应） */
  private connHandle = 0
  /** 内联回退的模块加载器（子进程持续不可用时启用） */
  private inline = false

  private ensureChild(): Electron.UtilityProcess | null {
    if (this.inline) return null
    if (this.spawnFailed) return null
    if (this.child) return this.child

    try {
      const workerPath = path.join(__dirname, 'lancedb.worker.js')
      this.child = utilityProcess.fork(workerPath, [], { stdio: 'pipe' })

      this.child.on('message', (res: LanceDbResponse) => {
        const task = this.pending.get(res.id)
        if (task) {
          this.pending.delete(res.id)
          clearTimeout(task.timer)
          task.resolve(res)
        }
      })

      this.child.on('exit', (code) => {
        this.failPending(`worker exited (code=${code})`)
        this.child = null
        // 句柄随子进程一起失效，重置计数避免新旧句柄混用
        this.connHandle = 0
        if (this.restarts < MAX_RESTARTS) {
          this.restarts++
          const delay = Math.min(1000 * 2 ** (this.restarts - 1), 8000)
          logger.system.warn(`[LanceDbProxy] worker crashed (code=${code}), restart #${this.restarts} in ${delay}ms`)
          setTimeout(() => { this.ensureChild() }, delay)
        } else {
          logger.system.warn('[LanceDbProxy] restart limit reached, switch to inline fallback mode')
          this.inline = true
        }
      })

      this.restarts = 0
      return this.child
    } catch (err) {
      logger.system.warn('[LanceDbProxy] fork failed, fallback to inline:', err)
      this.inline = true
      return null
    }
  }

  private call(req: RequestBody): Promise<LanceDbResponse> {
    const child = this.ensureChild()
    if (!child) return Promise.resolve(this.inlineError('inline mode'))

    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ id, ok: false, error: `timeout after ${OP_TIMEOUT_MS}ms` })
      }, OP_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      child.postMessage({ ...req, id } as LanceDbRequest)
    })
  }

  /** 子进程不可用 / 崩溃时，等待中的操作以错误结束（各 Store 已有 try/catch 兜底） */
  private failPending(reason: string): void {
    if (this.pending.size === 0) return
    logger.system.warn(`[LanceDbProxy] ${reason}, ${this.pending.size} pending op(s) fail`)
    for (const [id, task] of this.pending) {
      this.pending.delete(id)
      clearTimeout(task.timer)
      task.resolve({ id, ok: false, error: reason })
    }
  }

  private inlineError(op: string): LanceDbResponse {
    return { id: -1, ok: false, error: `${op} unavailable: lancedb worker disabled` }
  }

  /** 内联回退：主进程动态 import（与旧实现等价） */
  private async inlineConnect(dbPath: string): Promise<ProxyConnection> {
    const lancedb = (await import('@lancedb/lancedb')) as any
    const db = await lancedb.connect(dbPath)
    const wrapTable = (t: any): ProxyTable => ({
      countRows: () => t.countRows(),
      add: (d) => t.add(d),
      delete: (f) => t.delete(f),
      query: () => wrapBuilder(t.query()),
      search: (v) => wrapBuilder(t.search(v)),
    })
    const wrapBuilder = (b: any): ProxyQueryBuilder => ({
      select: (c) => wrapBuilder(b.select(c)),
      where: (f) => wrapBuilder(b.where(f)),
      limit: (n) => wrapBuilder(b.limit(n)),
      orderBy: (c, d) => wrapBuilder(b.orderBy(c, d)),
      toArray: () => b.toArray(),
      execute: async function* () {
        const rows = await b.toArray()
        yield* rows
      },
    })
    return {
      tableNames: () => db.tableNames(),
      openTable: async (n) => wrapTable(await db.openTable(n)),
      createTable: async (n, d) => wrapTable(await db.createTable(n, d)),
      dropTable: (n) => db.dropTable(n),
    }
  }

  /** 连接数据库，返回与原 LanceDB API 同形的代理对象 */
  async connect(dbPath: string): Promise<ProxyConnection> {
    const res = await this.call({ op: 'connect', path: dbPath })
    if (!res.ok) {
      // fork 失败等场景转内联
      if (this.inline) return this.inlineConnect(dbPath)
      throw new Error(res.error)
    }
    const conn = res.value as number
    this.connHandle = Math.max(this.connHandle, conn)

    const proxyTable = (tableId: number): ProxyTable => ({
      countRows: async () => {
        const r = await this.call({ op: 'call', table: tableId, method: 'countRows', args: [] })
        if (!r.ok) throw new Error(r.error)
        return r.value as number
      },
      add: async (data) => {
        const r = await this.call({ op: 'call', table: tableId, method: 'add', args: [data] })
        if (!r.ok) throw new Error(r.error)
      },
      delete: async (filter) => {
        const r = await this.call({ op: 'call', table: tableId, method: 'delete', args: [filter] })
        if (!r.ok) throw new Error(r.error)
      },
      query: () => this.makeBuilder(tableId, 'query'),
      search: (vector) => this.makeBuilder(tableId, 'search', vector),
    })

    return {
      tableNames: async () => {
        const r = await this.call({ op: 'call', conn, method: 'tableNames', args: [] })
        if (!r.ok) throw new Error(r.error)
        return r.value as string[]
      },
      openTable: async (name) => {
        const r = await this.call({ op: 'call', conn, method: 'openTable', args: [name] })
        if (!r.ok) throw new Error(r.error)
        return proxyTable(r.value as number)
      },
      createTable: async (name, data) => {
        const r = await this.call({ op: 'call', conn, method: 'createTable', args: [name, data] })
        if (!r.ok) throw new Error(r.error)
        return proxyTable(r.value as number)
      },
      dropTable: async (name) => {
        const r = await this.call({ op: 'call', conn, method: 'dropTable', args: [name] })
        if (!r.ok) throw new Error(r.error)
      },
    }
  }

  /** 链式查询构建器：收集条件，toArray() 时一次性下发 */
  private makeBuilder(tableId: number, kind: 'query' | 'search', vector?: number[]): ProxyQueryBuilder {
    const state: {
      select?: string[]
      where?: string
      limit?: number
      orderBy?: { column: string; direction: 'ASC' | 'DESC' }
    } = {}

    const wrap = (): ProxyQueryBuilder => ({
      select: (c) => { state.select = c; return wrap() },
      where: (f) => { state.where = f; return wrap() },
      limit: (n) => { state.limit = n; return wrap() },
      orderBy: (c, d) => { state.orderBy = { column: c, direction: d }; return wrap() },
      toArray: async () => {
        const r = await this.call({
          op: 'chain', table: tableId, kind,
          vector, select: state.select, where: state.where,
          limit: state.limit, orderBy: state.orderBy,
        })
        if (!r.ok) throw new Error(r.error)
        return (r.value ?? []) as Record<string, unknown>[]
      },
      execute: async function* () {
        const rows = await wrap().toArray()
        yield* rows
      },
    })
    return wrap()
  }

  dispose(): void {
    this.failPending('proxy disposed')
    this.child?.kill()
    this.child = null
  }
}

export const lancedbProxy = new LanceDbProxyImpl()
