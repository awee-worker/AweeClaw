/**
 * 待办中心 · 数据层
 *
 * 统一汇总来自不同来源的待办事项：
 * - manual     手动创建
 * - conversation 会话执行时未完成的任务
 * - mounted    会话被停止后挂载的任务
 * - mail       邮件中心 AI 整理出的待办
 * - project    项目 / 后端任务中未完成的任务
 *
 * 持久化与场景工具共用同一套 SQLite 存储（key: scene-tools:todo-hub），
 * 因此重启客户端后待办依然保留。同一来源用 dedupeKey 去重：同一条待办无论
 * 是否已完成都只保留一条；用户删除过的再用 tombstones 记住，来源仍在时也
 * 不会重新生成。
 *
 * 执行态（executing）不跨进程存活：重新打开客户端时上一轮执行必然已经结束，
 * 水合时统一把残留的执行态退回待办，避免清单永远停在「AI 执行中」。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sceneToolsPersistStorage, uid } from '../scene-tools/stores'

/** 删除记录（tombstone）保留上限：超出后丢弃最旧的，避免无限增长 */
const MAX_TOMBSTONES = 500

/** 记录一次删除：同一去重键只留一条，最新的排最前，超限时裁掉最旧的 */
function rememberTombstone(list: string[], dedupeKey: string): string[] {
  const next = [dedupeKey, ...list.filter((k) => k !== dedupeKey)]
  return next.length > MAX_TOMBSTONES ? next.slice(0, MAX_TOMBSTONES) : next
}

/** 待办来源类型 */
export type TodoSourceType = 'manual' | 'conversation' | 'mounted' | 'mail' | 'project'

export interface HubTodoItem {
  id: string
  createdAt: number
  /** 待办标题 */
  title: string
  /** 补充说明（来源摘要等） */
  detail?: string
  /** pending 未开始 / executing AI 执行中 / done 已完成 */
  status: 'pending' | 'executing' | 'done'
  priority: 'high' | 'medium' | 'low'
  /** 来源类型 */
  sourceType: TodoSourceType
  /** 来源实体 id：会话 id / 项目任务 id 等，用于跳转与去重 */
  sourceId?: string
  /** 来源展示名：会话标题 / 邮件主题 / 项目名 */
  sourceLabel?: string
  /** 来源跳转所需的附加定位信息（如邮件的 accountId/folder/uid） */
  sourceMeta?: Record<string, string>
  /** 截止日期 YYYY-MM-DD */
  dueDate?: string
  /** 完成时间 */
  completedAt?: number
  /** AI 执行后的结果摘要 */
  aiNote?: string
  /** AI 执行该待办时所处的会话 id；执行结束据此回收执行态 */
  executingThreadId?: string
  /** 进入执行态的时间戳 */
  executingAt?: number
  /** 去重键，同源同内容只保留一条 */
  dedupeKey: string
}

interface TodoHubState {
  items: HubTodoItem[]
  /**
   * 已删除待办的去重键（tombstone）。
   *
   * 待办来源是实时采集的：只要会话里那条任务还没被标记完成、挂载还没卸下，
   * 采集就会把它重新加回清单。用户删除某条待办后，若不记住这次删除，下一轮
   * 采集它就又回来了。这里按去重键记住删除意图，来源仍在时也不再重新生成。
   */
  tombstones: string[]
  /**
   * 新增待办。
   * 若该去重键已被删除过，返回 null；若已存在同键条目（不论完成与否），
   * 直接返回已有条目。两种情况都不会重复插入。
   */
  add: (input: Omit<HubTodoItem, 'id' | 'createdAt'>) => HubTodoItem | null
  update: (id: string, patch: Partial<HubTodoItem>) => void
  remove: (id: string) => void
  /** 标记完成（列表中默认随即隐藏） */
  complete: (id: string) => void
  /** 撤销完成 */
  restore: (id: string) => void
  /** 按去重键移除（来源消失时同步清理，如会话被删除） */
  removeByDedupe: (dedupeKey: string) => void
  /** 清理全部已完成项（同样记为删除） */
  clearDone: () => void
  reset: () => void
}

export const useTodoHubStore = create<TodoHubState>()(
  persist(
    (set, get) => ({
      items: [],
      tombstones: [],
      add: (input) => {
        if (!input.dedupeKey) return null

        const { items, tombstones } = get()

        // 用户删除过这条待办：来源仍在也不再重新生成
        if (tombstones.includes(input.dedupeKey)) return null

        // 同源同内容只保留一条：只要去重键已存在就直接复用，不再判断完成状态。
        // 早前只拦「未完成」的条目，已完成的待办会在来源下次采集时重新插入，
        // 表现为从清单消失后又「复活」——用户明明已经处理过，却又冒出来一条。
        const existing = items.find((i) => i.dedupeKey === input.dedupeKey)
        if (existing) return existing

        const full: HubTodoItem = { ...input, id: uid('todo'), createdAt: Date.now() }
        set((s) => ({ items: [full, ...s.items] }))
        return full
      },
      update: (id, patch) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      remove: (id) =>
        set((s) => {
          const target = s.items.find((i) => i.id === id)
          return {
            items: s.items.filter((i) => i.id !== id),
            // 记下这次删除：来源下次采集时不再把这条塞回来
            tombstones: target ? rememberTombstone(s.tombstones, target.dedupeKey) : s.tombstones,
          }
        }),
      complete: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, status: 'done', completedAt: Date.now() } : i,
          ),
        })),
      restore: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, status: 'pending', completedAt: undefined } : i,
          ),
        })),
      removeByDedupe: (dedupeKey) =>
        set((s) => ({
          items: s.items.filter((i) => i.dedupeKey !== dedupeKey),
          // 来源已不存在，对应的删除记录也一并清掉，来源日后重建时能正常进清单
          tombstones: s.tombstones.filter((k) => k !== dedupeKey),
        })),
      clearDone: () =>
        set((s) => {
          // 「清除已完成」同样是用户的删除意图：来源仍在时不再重新生成
          let tombstones = s.tombstones
          for (const item of s.items) {
            if (item.status === 'done') tombstones = rememberTombstone(tombstones, item.dedupeKey)
          }
          return { items: s.items.filter((i) => i.status !== 'done'), tombstones }
        }),
      reset: () => set({ items: [], tombstones: [] }),
    }),
    {
      name: 'scene-tools:todo-hub',
      storage: sceneToolsPersistStorage,
      /**
       * 水合后收敛执行态。
       *
       * 待办在 AI 执行期间被置为 executing，但进程退出会带走正在跑的那一轮，
       * 状态本身却留在了存储里。这里把残留的执行态统一退回待办，否则待办中心
       * 会一直显示「AI 执行中」且没有任何入口能恢复。
       *
       * 存储是异步的，回调在 store 定义完成后才触发，可以安全地读自身。
       */
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const store = useTodoHubStore.getState()
        for (const item of store.items) {
          if (item.status === 'executing') {
            store.update(item.id, { status: 'pending', executingThreadId: undefined })
          }
        }
      },
    },
  ),
)

/** 未完成待办数量（用于左侧菜单角标） */
export function selectTodoHubPendingCount(state: { items: HubTodoItem[] }): number {
  return state.items.filter((i) => i.status !== 'done').length
}
