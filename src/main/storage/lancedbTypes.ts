/**
 * LanceDB RPC 协议类型 — 主进程代理与子进程 worker 共用
 *
 * 目标：把 @lancedb/lancedb 的 native 模块加载移出主进程。
 * 表对象不直接跨进程传递，而是以句柄（tableId / connId）引用，
 * 链式查询（query/search builder）在调用 toArray() 时一次性下发。
 *
 * @module storage/lancedbTypes
 */

/** 主进程 → 子进程请求 */
export type LanceDbRequest =
  | { id: number; op: 'connect'; path: string }
  | { id: number; op: 'close'; conn: number }
  | {
      id: number
      op: 'call'
      conn?: number
      table?: number
      method: 'tableNames' | 'openTable' | 'createTable' | 'dropTable'
      | 'countRows' | 'add' | 'delete'
      args: unknown[]
    }
  | {
      id: number
      op: 'chain'
      table: number
      kind: 'query' | 'search'
      vector?: number[]
      select?: string[]
      where?: string
      limit?: number
      orderBy?: { column: string; direction: 'ASC' | 'DESC' }
    }

/** 子进程 → 主进程响应 */
export interface LanceDbResponse {
  id: number
  ok: boolean
  /** 成功时的返回值（句柄数字 / 行数组 / 行数等） */
  value?: unknown
  error?: string
}
