/**
 * LanceDB 子进程入口 — native 模块加载与执行在 utilityProcess 中
 *
 * 职责：
 * - 接收主进程派发的 connect / call / chain RPC
 * - 连接与表对象以自增句柄存于本进程，仅回传句柄号
 * - 链式查询（query/search builder）整条下发，一次执行
 *
 * 说明：作为 CJS 单独入口构建（lancedb.worker.js），不进主 bundle；
 * @lancedb/lancedb 与 apache-arrow 全部 external，由子进程从 node_modules 解析。
 */

if (!process.parentPort) {
  throw new Error('This file must be run as a utility process.')
}

import type { LanceDbRequest, LanceDbResponse } from './lancedbTypes'

/** 最小接口声明（只列用到的成员，避免引 native 包的类型） */
interface DbTable {
  countRows(): Promise<number>
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  query(): any
  search(vector: number[]): any
}

interface DbConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<DbTable>
  createTable(name: string, data: unknown[]): Promise<DbTable>
  dropTable(name: string): Promise<void>
}

const connections = new Map<number, DbConnection>()
const tables = new Map<number, DbTable>()
let nextHandle = 1

function ok(id: number, value?: unknown): void {
  process.parentPort!.postMessage({ id, ok: true, value } satisfies LanceDbResponse)
}

function fail(id: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  process.parentPort!.postMessage({ id, ok: false, error: message } satisfies LanceDbResponse)
}

async function handle(req: LanceDbRequest): Promise<void> {
  try {
    if (req.op === 'connect') {
      const lancedb = (await import('@lancedb/lancedb')) as any
      const db = (await lancedb.connect(req.path)) as DbConnection
      const handleId = nextHandle++
      connections.set(handleId, db)
      ok(req.id, handleId)
      return
    }

    if (req.op === 'close') {
      connections.delete(req.conn)
      ok(req.id)
      return
    }

    if (req.op === 'call') {
      let target: unknown
      if (req.table !== undefined) {
        target = tables.get(req.table)
        if (!target) throw new Error(`invalid table handle: ${req.table}`)
      } else if (req.conn !== undefined) {
        target = connections.get(req.conn)
        if (!target) throw new Error(`invalid connection handle: ${req.conn}`)
      } else {
        throw new Error('call requires conn or table')
      }

      const result = await (target as any)[req.method](...req.args)

      // openTable / createTable 返回表对象，转成句柄回传
      if (req.method === 'openTable' || req.method === 'createTable') {
        const tableId = nextHandle++
        tables.set(tableId, result as DbTable)
        ok(req.id, tableId)
      } else {
        ok(req.id, result)
      }
      return
    }

    // op === 'chain'
    const table = tables.get(req.table)
    if (!table) throw new Error(`invalid table handle: ${req.table}`)

    let builder = req.kind === 'search' ? table.search(req.vector!) : table.query()
    if (req.select?.length) builder = builder.select(req.select)
    if (req.where) builder = builder.where(req.where)
    if (req.orderBy) builder = builder.orderBy(req.orderBy.column, req.orderBy.direction)
    if (req.limit !== undefined) builder = builder.limit(req.limit)

    const rows = await builder.toArray()
    ok(req.id, rows)
  } catch (err) {
    fail(req.id, err)
  }
}

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  void handle(e.data as LanceDbRequest)
})
