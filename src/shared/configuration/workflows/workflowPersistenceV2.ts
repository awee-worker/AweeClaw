/**
 * 工作流定义持久化
 *
 * 存储迁移：localStorage → SQLite（workflows.db）
 *
 * 为什么必须保留同步签名：
 * 所有调用方都在 `useState(() => loadWorkflowDefinitions())` 里同步取数，
 * 改成 Promise 会让首屏拿到 undefined，且要改动 5 个文件 10+ 处调用点。
 *
 * 因此采用「内存镜像 + 写穿透」：
 * - 读：同步返回内存镜像；镜像未就绪时回退旧 localStorage（首屏不空窗）
 * - 写：同步改内存，再串行异步落 SQLite
 * - 就绪：hydrate 完成时通知订阅者刷新（UI 拿到最新数据）
 *
 * SQLite 不可用（Node < 22 / 初始化失败）时整体降级回 localStorage，
 * 功能不中断，只丧失容量与查询优势。
 */

import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import { StorageService } from '@shared/toolkit/StorageService'
import { logger } from '@shared/toolkit/LogEngine'

const DEFINITIONS_KEY = 'workflow_definitions_v2'
/** 一次性迁移标记：置位后不再从 localStorage 导入，避免删除后又被复活 */
const LEGACY_IMPORTED_KEY = 'workflow_definitions_legacy_imported'
const MAX_DEFINITIONS = 100

// ── 内存镜像 ──────────────────────────────────────────────
/** null = 尚未 hydrate；空数组 = 已 hydrate 且确定为空 */
let cache: WorkflowDefinitionV2[] | null = null
let hydratePromise: Promise<void> | null = null
/** SQLite 写入链：串行执行，保证同一 id 的连续保存按调用顺序落盘 */
let writeChain: Promise<void> = Promise.resolve()
const readyListeners = new Set<() => void>()

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

// ── 旧路径（降级 / 首屏兜底） ─────────────────────────────

function readLegacy(): WorkflowDefinitionV2[] {
  try {
    const data = StorageService.get<WorkflowDefinitionV2[]>(DEFINITIONS_KEY)
    return data && Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeLegacy(defs: WorkflowDefinitionV2[]): void {
  try {
    StorageService.set(DEFINITIONS_KEY, defs.slice(0, MAX_DEFINITIONS))
  } catch (e) {
    // 降级路径本身失败只能记录：此时 SQLite 也不可用，已无更稳的落点
    logger.ui.warn('[WorkflowPersistence] localStorage fallback write failed:', e)
  }
}

/**
 * 串行化写操作。
 *
 * 不并发：同一工作流在快速连续保存时，并发 IPC 可能乱序到达主进程，
 * 导致先发后至、旧数据覆盖新数据。
 */
function enqueueWrite(task: () => Promise<void>): void {
  writeChain = writeChain.then(task).catch((e) => {
    logger.ui.warn('[WorkflowPersistence] Persist failed:', e)
  })
}

// ── hydrate ──────────────────────────────────────────────

/**
 * 从 SQLite 载入全量到内存镜像。
 *
 * 首次运行会把旧 localStorage 数据搬进 SQLite（一次性，带标记）。
 * 任一步失败都整体降级，不抛错——持久化不可用不该阻断编辑器打开。
 */
export function hydrateWorkflowStore(): Promise<void> {
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    const api = bridge()
    if (!api?.workflowDbListDefs) return // 非 Electron 环境，留在 localStorage

    try {
      const init = await api.workflowDbInitialize()
      if (!init?.ok) {
        logger.ui.warn('[WorkflowPersistence] SQLite init failed, staying on localStorage:', init?.error)
        return
      }

      // 一次性迁移
      if (!StorageService.get<boolean>(LEGACY_IMPORTED_KEY)) {
        const legacyDefs = readLegacy()
        if (legacyDefs.length > 0) {
          const migrated = await api.workflowDbImportLegacy({
            defs: legacyDefs.map((d) => ({
              id: d.id,
              name: d.name || '',
              payload: JSON.stringify(d),
              createdAt: d.createdAt,
              updatedAt: d.updatedAt,
            })),
          })
          if (migrated?.ok) {
            // 只在迁移成功后置标记：失败时下次启动会重试，不会漏数据
            StorageService.set(LEGACY_IMPORTED_KEY, true)
            logger.ui.info(
              `[WorkflowPersistence] Migrated ${migrated.defs ?? 0} definitions from localStorage`,
            )
          }
        } else {
          StorageService.set(LEGACY_IMPORTED_KEY, true)
        }
      }

      const listed = await api.workflowDbListDefs()
      if (!listed?.ok || !Array.isArray(listed.rows)) return

      const defs = listed.rows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as WorkflowDefinitionV2
          } catch {
            // 单条损坏不该拖垮整个列表：跳过并记录，其余正常加载
            logger.ui.warn(`[WorkflowPersistence] Corrupted definition skipped: ${row.id}`)
            return null
          }
        })
        .filter((d): d is WorkflowDefinitionV2 => !!d)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

      cache = defs
      notifyReady()
      logger.ui.info(`[WorkflowPersistence] Hydrated ${defs.length} definitions from SQLite`)
    } catch (e) {
      logger.ui.warn('[WorkflowPersistence] Hydrate failed, falling back to localStorage:', e)
    }
  })()

  return hydratePromise
}

function notifyReady(): void {
  for (const fn of readyListeners) {
    try {
      fn()
    } catch (e) {
      logger.ui.warn('[WorkflowPersistence] ready listener threw:', e)
    }
  }
}

/**
 * 订阅「持久化已就绪」。
 *
 * UI 用它把首屏的 localStorage 兜底数据换成 SQLite 真实数据。
 * 返回取消订阅函数，调用方负责清理。
 */
export function onWorkflowStoreReady(cb: () => void): () => void {
  readyListeners.add(cb)
  if (cache !== null) {
    // 已就绪：异步回调一次，避免订阅者在同步栈里重入
    queueMicrotask(() => {
      try {
        cb()
      } catch (e) {
        logger.ui.warn('[WorkflowPersistence] ready listener threw:', e)
      }
    })
  }
  return () => readyListeners.delete(cb)
}

// ── 对外 API（签名与旧版一致） ────────────────────────────

export function loadWorkflowDefinitions(): WorkflowDefinitionV2[] {
  if (cache !== null) return cache.slice()
  return readLegacy()
}

export function loadWorkflowDefinition(id: string): WorkflowDefinitionV2 | null {
  const defs = cache ?? readLegacy()
  return defs.find((d) => d.id === id) || null
}

export function saveWorkflowDefinition(def: WorkflowDefinitionV2): void {
  const toSave: WorkflowDefinitionV2 = { ...def, updatedAt: Date.now() }

  // 1) 内存：立即可读
  const base = cache ?? readLegacy()
  const idx = base.findIndex((d) => d.id === toSave.id)
  if (idx >= 0) base[idx] = toSave
  else base.unshift(toSave)
  const trimmed = base.slice(0, MAX_DEFINITIONS)
  cache = trimmed

  // 2) 落盘
  const api = bridge()
  if (!api?.workflowDbUpsertDef) {
    writeLegacy(trimmed)
    return
  }

  enqueueWrite(async () => {
    const res = await api.workflowDbUpsertDef({
      id: toSave.id,
      name: toSave.name || '',
      payload: JSON.stringify(toSave),
      createdAt: toSave.createdAt,
      updatedAt: toSave.updatedAt,
    })
    if (!res?.ok) {
      // SQLite 写失败：回退 localStorage，保证数据至少落在一处
      logger.ui.warn('[WorkflowPersistence] SQLite upsert failed, fallback to localStorage:', res?.error)
      writeLegacy(cache ?? trimmed)
      return
    }
    // 超出上限的旧条目从库里清掉，与内存裁剪保持一致
    const overflow = base.slice(MAX_DEFINITIONS)
    for (const old of overflow) {
      await api.workflowDbDeleteDef?.(old.id)
    }
  })
}

export function deleteWorkflowDefinition(id: string): void {
  const base = cache ?? readLegacy()
  const filtered = base.filter((d) => d.id !== id)
  cache = filtered

  const api = bridge()
  if (!api?.workflowDbDeleteDef) {
    writeLegacy(filtered)
    return
  }
  enqueueWrite(async () => {
    const res = await api.workflowDbDeleteDef?.(id)
    if (!res?.ok) {
      logger.ui.warn('[WorkflowPersistence] SQLite delete failed, fallback to localStorage:', res?.error)
      writeLegacy(cache ?? filtered)
    }
  })
}

export function duplicateWorkflowDefinition(id: string): WorkflowDefinitionV2 | null {
  const original = loadWorkflowDefinition(id)
  if (!original) return null

  const now = Date.now()
  const duplicate: WorkflowDefinitionV2 = {
    ...JSON.parse(JSON.stringify(original)),
    id: `wf-${now}`,
    name: `${original.name} (Copy)`,
    nameZh: `${original.nameZh} (副本)`,
    createdAt: now,
    updatedAt: now,
  }
  saveWorkflowDefinition(duplicate)
  return duplicate
}

export function exportWorkflowDefinition(def: WorkflowDefinitionV2): string {
  return JSON.stringify(def, null, 2)
}

export function importWorkflowDefinition(json: string): WorkflowDefinitionV2 | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed.id || !parsed.nodes || !Array.isArray(parsed.nodes)) {
      return null
    }
    const now = Date.now()
    const imported: WorkflowDefinitionV2 = {
      ...parsed,
      id: `wf-${now}`,
      name: parsed.name || 'Imported Workflow',
      nameZh: parsed.nameZh || '导入的工作流',
      createdAt: now,
      updatedAt: now,
    }
    saveWorkflowDefinition(imported)
    return imported
  } catch {
    return null
  }
}

// 模块加载即触发 hydrate（不阻塞任何同步调用，完成后再通知 UI）
void hydrateWorkflowStore()
