/**
 * 场景工具数据域工厂
 *
 * 提供 SceneToolDS 接口和 listDS 通用工厂，
 * 供各工具模块使用，避免在 agentBridge.ts 中重复定义。
 */

// ============================================
// 类型定义
// ============================================

export type OpResult = { ok: boolean; id?: string; error?: string }

export interface SceneToolDS {
  id: string
  name: string
  mode: 'work' | 'life' | 'study'
  description: string
  /** 新增条目时接受的字段说明（给 LLM 看） */
  itemSchema: string
  read: () => unknown
  add?: (item: Record<string, unknown>) => OpResult
  update?: (id: string, patch: Record<string, unknown>) => OpResult
  remove?: (id: string) => OpResult
}

/** 用于 initSceneToolEventTracking 的摘要函数类型 */
export type TrackKeyFn = (item: unknown) => string

// ============================================
// 通用 list store 适配器
// ============================================

interface ListStoreLike {
  items: unknown[]
  add: (item: any) => { id?: string }
  update: (id: string, patch: any) => void
  remove: (id: string) => void
}

/**
 * 通用 list store 适配器工厂
 * 适用于标准增删改查工具（todo、meeting、ledger 等）。
 */
export function listDS(
  id: string,
  name: string,
  mode: SceneToolDS['mode'],
  description: string,
  itemSchema: string,
  getStore: () => ListStoreLike,
  opts?: { readTransform?: (items: unknown[]) => unknown },
): SceneToolDS {
  return {
    id,
    name,
    mode,
    description,
    itemSchema,
    read: () => {
      const items = getStore().items
      return opts?.readTransform ? opts.readTransform(items) : items
    },
    add: (item) => {
      try {
        const created = getStore().add(item)
        return { ok: true, id: created?.id }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    update: (id2, patch) => {
      try {
        getStore().update(id2, patch)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    remove: (id2) => {
      try {
        getStore().remove(id2)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
