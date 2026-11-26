/**
 * 工作流数据库桥接 — SQLite 工作流库的 IPC 接口
 *
 * 频道：
 * - workflow-db:initialize     — 初始化（建表，幂等）
 * - workflow-db:listDefs       — 列出全部工作流定义
 * - workflow-db:getDef         — 取单条定义
 * - workflow-db:upsertDef      — 写入/覆盖单条定义
 * - workflow-db:deleteDef      — 删除单条定义
 * - workflow-db:listRuns       — 列出运行历史（按开始时间倒序）
 * - workflow-db:upsertRun      — 写入/覆盖单条运行记录
 * - workflow-db:trimRuns       — 裁剪历史到最近 N 条
 * - workflow-db:clearRuns      — 清空运行历史
 * - workflow-db:importLegacy   — 一次性导入旧 localStorage 数据
 * - workflow-db:getPath        — 取库文件路径（排查/备份用）
 *
 * 数据完整性约束由渲染进程保证：payload 是完整记录的 JSON 字符串，
 * 主进程不解析其内部结构，只负责按 id 存取与排序。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { workflowDb } from '../../modules/workflow-db'

/** 统一失败响应：错误码固定，便于渲染进程分支处理而不依赖错误文案 */
function fail(code: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  logger.ui.error(`[WorkflowDb] ${code}:`, err)
  return { ok: false as const, code, error: message }
}

export function registerWorkflowDbIpcHandlers(): void {
  safeIpcHandle('workflow-db:initialize', async () => {
    try {
      await workflowDb.initialize()
      return { ok: true as const, dbPath: workflowDb.getFilePath() }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle('workflow-db:listDefs', async () => {
    try {
      await workflowDb.initialize()
      return { ok: true as const, rows: workflowDb.listDefinitions() }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle('workflow-db:getDef', async (_e, id: string) => {
    if (typeof id !== 'string' || !id) {
      return { ok: false as const, code: 'INVALID_PAYLOAD', error: 'id 必须是非空字符串' }
    }
    try {
      await workflowDb.initialize()
      return { ok: true as const, row: workflowDb.getDefinition(id) }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle(
    'workflow-db:upsertDef',
    async (
      _e,
      def: { id?: string; name?: string; payload?: string; createdAt?: number; updatedAt?: number },
    ) => {
      if (!def || typeof def.id !== 'string' || !def.id || typeof def.payload !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_PAYLOAD',
          error: 'def 必须包含非空 id 与字符串 payload',
        }
      }
      try {
        await workflowDb.initialize()
        workflowDb.upsertDefinition({
          id: def.id,
          name: def.name || '',
          payload: def.payload,
          createdAt: def.createdAt,
          updatedAt: def.updatedAt,
        })
        return { ok: true as const }
      } catch (err) {
        return fail('DB_UNAVAILABLE', err)
      }
    },
  )

  safeIpcHandle('workflow-db:deleteDef', async (_e, id: string) => {
    if (typeof id !== 'string' || !id) {
      return { ok: false as const, code: 'INVALID_PAYLOAD', error: 'id 必须是非空字符串' }
    }
    try {
      await workflowDb.initialize()
      workflowDb.deleteDefinition(id)
      return { ok: true as const }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle('workflow-db:listRuns', async (_e, limit?: number) => {
    try {
      await workflowDb.initialize()
      const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 50
      return { ok: true as const, rows: workflowDb.listRuns(n) }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle(
    'workflow-db:upsertRun',
    async (
      _e,
      run: {
        id?: string
        workflowId?: string
        status?: string
        payload?: string
        startedAt?: number
        updatedAt?: number
      },
    ) => {
      if (!run || typeof run.id !== 'string' || !run.id || typeof run.payload !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_PAYLOAD',
          error: 'run 必须包含非空 id 与字符串 payload',
        }
      }
      try {
        await workflowDb.initialize()
        workflowDb.upsertRun({
          id: run.id,
          workflowId: run.workflowId || '',
          status: run.status || '',
          payload: run.payload,
          startedAt: run.startedAt || 0,
          updatedAt: run.updatedAt || Date.now(),
        })
        return { ok: true as const }
      } catch (err) {
        return fail('DB_UNAVAILABLE', err)
      }
    },
  )

  safeIpcHandle('workflow-db:trimRuns', async (_e, keep: number) => {
    try {
      await workflowDb.initialize()
      const n = typeof keep === 'number' && keep >= 0 ? keep : 50
      return { ok: true as const, deleted: workflowDb.trimRuns(n) }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle('workflow-db:deleteRun', async (_e, id: string) => {
    if (typeof id !== 'string' || !id) {
      return { ok: false as const, code: 'INVALID_PAYLOAD', error: 'id 必须是非空字符串' }
    }
    try {
      await workflowDb.initialize()
      workflowDb.deleteRun(id)
      return { ok: true as const }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  safeIpcHandle('workflow-db:clearRuns', async () => {
    try {
      await workflowDb.initialize()
      workflowDb.clearRuns()
      return { ok: true as const }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })

  /**
   * 一次性导入旧 localStorage 数据。
   * 幂等键 `legacy_imported` 由渲染进程判断与写入，这里只负责搬运；
   * 若渲染进程重复调用，已存在的 id 会被跳过，不会产生重复。
   */
  safeIpcHandle(
    'workflow-db:importLegacy',
    async (
      _e,
      payload: {
        defs?: Array<{ id: string; name?: string; payload: string; createdAt?: number; updatedAt?: number }>
        runs?: Array<{ id: string; workflowId?: string; status?: string; payload: string; startedAt?: number; updatedAt?: number }>
      },
    ) => {
      try {
        await workflowDb.initialize()
        const result = workflowDb.importLegacy(payload?.defs ?? [], payload?.runs ?? [])
        return { ok: true as const, ...result }
      } catch (err) {
        return fail('DB_UNAVAILABLE', err)
      }
    },
  )

  safeIpcHandle('workflow-db:getPath', async () => {
    try {
      await workflowDb.initialize()
      return { ok: true as const, path: workflowDb.getFilePath() }
    } catch (err) {
      return fail('DB_UNAVAILABLE', err)
    }
  })
}
