/**
 * 工作流运行历史持久化
 *
 * 存储迁移：localStorage → SQLite（workflows.db 的 workflow_runs 表）
 *
 * 与 workflowPersistenceV2 同样的「内存镜像 + 写穿透」策略，理由见该文件。
 * 额外区别：运行历史写入频率更高（一次运行会多次推进状态），
 * 因此 SQLite 侧额外维护 status 独立列，后续可按状态筛选而不必解析 payload。
 */

import type { WorkflowRunV2 } from '@shared/protocols/workflowV2'
import { StorageService } from '@shared/toolkit/StorageService'
import { logger } from '@shared/toolkit/LogEngine'

const HISTORY_KEY = 'workflow_history_v2'
const LEGACY_IMPORTED_KEY = 'workflow_history_legacy_imported'
const MAX_HISTORY = 50

let cache: WorkflowRunV2[] | null = null
let hydratePromise: Promise<void> | null = null
let writeChain: Promise<void> = Promise.resolve()
const readyListeners = new Set<() => void>()

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

function readLegacy(): WorkflowRunV2[] {
  try {
    const data = StorageService.get<WorkflowRunV2[]>(HISTORY_KEY)
    return data && Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeLegacy(runs: WorkflowRunV2[]): void {
  try {
    StorageService.set(HISTORY_KEY, runs.slice(0, MAX_HISTORY))
  } catch (e) {
    logger.ui.warn('[RunHistory] localStorage fallback write failed:', e)
  }
}

function enqueueWrite(task: () => Promise<void>): void {
  writeChain = writeChain.then(task).catch((e) => {
    logger.ui.warn('[RunHistory] Persist failed:', e)
  })
}

function notifyReady(): void {
  for (const fn of readyListeners) {
    try {
      fn()
    } catch (e) {
      logger.ui.warn('[RunHistory] ready listener threw:', e)
    }
  }
}

export function hydrateWorkflowHistory(): Promise<void> {
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    const api = bridge()
    if (!api?.workflowDbListRuns) return

    try {
      const init = await api.workflowDbInitialize()
      if (!init?.ok) return

      // 一次性迁移旧数据
      if (!StorageService.get<boolean>(LEGACY_IMPORTED_KEY)) {
        const legacyRuns = readLegacy()
        if (legacyRuns.length > 0) {
          const migrated = await api.workflowDbImportLegacy({
            runs: legacyRuns.map((r) => ({
              id: r.id,
              workflowId: r.workflowId,
              status: r.status,
              payload: JSON.stringify(r),
              startedAt: r.startedAt,
              updatedAt: r.completedAt ?? r.startedAt,
            })),
          })
          if (migrated?.ok) {
            StorageService.set(LEGACY_IMPORTED_KEY, true)
            logger.ui.info(`[RunHistory] Migrated ${migrated.runs ?? 0} runs from localStorage`)
          }
        } else {
          StorageService.set(LEGACY_IMPORTED_KEY, true)
        }
      }

      const listed = await api.workflowDbListRuns(MAX_HISTORY)
      if (!listed?.ok || !Array.isArray(listed.rows)) return

      cache = listed.rows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as WorkflowRunV2
          } catch {
            logger.ui.warn(`[RunHistory] Corrupted run skipped: ${row.id}`)
            return null
          }
        })
        .filter((r): r is WorkflowRunV2 => !!r)

      notifyReady()
    } catch (e) {
      logger.ui.warn('[RunHistory] Hydrate failed, falling back to localStorage:', e)
    }
  })()

  return hydratePromise
}

export function onWorkflowHistoryReady(cb: () => void): () => void {
  readyListeners.add(cb)
  if (cache !== null) {
    queueMicrotask(() => {
      try {
        cb()
      } catch (e) {
        logger.ui.warn('[RunHistory] ready listener threw:', e)
      }
    })
  }
  return () => readyListeners.delete(cb)
}

// ── 对外 API（签名与旧版一致） ────────────────────────────

export function loadWorkflowHistoryV2(): WorkflowRunV2[] {
  if (cache !== null) return cache.slice()
  return readLegacy()
}

export function saveWorkflowRunV2(run: WorkflowRunV2): void {
  const base = cache ?? readLegacy()
  const idx = base.findIndex((r) => r.id === run.id)
  if (idx >= 0) base[idx] = run
  else base.unshift(run)
  const trimmed = base.slice(0, MAX_HISTORY)
  cache = trimmed

  const api = bridge()
  if (!api?.workflowDbUpsertRun) {
    writeLegacy(trimmed)
    return
  }

  enqueueWrite(async () => {
    const res = await api.workflowDbUpsertRun({
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      payload: JSON.stringify(run),
      startedAt: run.startedAt,
      updatedAt: run.completedAt ?? Date.now(),
    })
    if (!res?.ok) {
      logger.ui.warn('[RunHistory] SQLite upsert failed, fallback to localStorage:', res?.error)
      writeLegacy(cache ?? trimmed)
      return
    }
    // 保持条数上限，与内存裁剪一致
    await api.workflowDbTrimRuns?.(MAX_HISTORY)
  })
}

export function updateWorkflowRunStatusV2(
  runId: string,
  updates: Partial<WorkflowRunV2>,
): void {
  const base = cache ?? readLegacy()
  const idx = base.findIndex((r) => r.id === runId)
  if (idx < 0) return

  const merged: WorkflowRunV2 = { ...base[idx], ...updates }
  base[idx] = merged
  cache = base

  const api = bridge()
  if (!api?.workflowDbUpsertRun) {
    writeLegacy(base)
    return
  }
  enqueueWrite(async () => {
    const res = await api.workflowDbUpsertRun({
      id: merged.id,
      workflowId: merged.workflowId,
      status: merged.status,
      payload: JSON.stringify(merged),
      startedAt: merged.startedAt,
      updatedAt: merged.completedAt ?? Date.now(),
    })
    if (!res?.ok) {
      logger.ui.warn('[RunHistory] SQLite patch failed, fallback to localStorage:', res?.error)
      writeLegacy(cache ?? base)
    }
  })
}

export function deleteWorkflowRunV2(runId: string): void {
  const base = cache ?? readLegacy()
  const filtered = base.filter((r) => r.id !== runId)
  cache = filtered

  const api = bridge()
  if (!api?.workflowDbDeleteRun) {
    writeLegacy(filtered)
    return
  }
  enqueueWrite(async () => {
    const res = await api.workflowDbDeleteRun?.(runId)
    if (!res?.ok) {
      logger.ui.warn('[RunHistory] SQLite delete failed, fallback to localStorage:', res?.error)
      writeLegacy(cache ?? filtered)
    }
  })
}

export function clearWorkflowHistoryV2(): void {
  cache = []

  const api = bridge()
  if (!api?.workflowDbClearRuns) {
    StorageService.remove(HISTORY_KEY)
    return
  }
  enqueueWrite(async () => {
    const res = await api.workflowDbClearRuns?.()
    if (!res?.ok) {
      logger.ui.warn('[RunHistory] SQLite clear failed, fallback to localStorage:', res?.error)
      StorageService.remove(HISTORY_KEY)
    }
  })
}

void hydrateWorkflowHistory()
