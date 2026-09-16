/**
 * userNotificationStore — 用户消息通知（后端 UserNotification）
 *
 * 与「运行消息」区分：
 *   - 运行消息：本地 InlineNotification toast（保存成功 / 请求失败等一次性提示），
 *     只存在于当前窗口，关掉就没了
 *   - 消息通知：后端持久化的提醒（套餐 / 场景 / 插件到期、支付成功、退款……），
 *     需要跨端同步、可回看、可标记已读
 *
 * 消息中心（右上角铃铛）同时展示两者，本 store 负责后者，
 * 并为「工作场景」「插件与技能」等入口提供未读角标。
 *
 * 轮询策略：登录后每 60s 拉一次。到期提醒是「按天」粒度的事件，
 * 60s 足够及时，也不会给后端带来压力。
 *
 * @module state/userNotificationStore
 */
import { create } from 'zustand'
import { backendApi, isAuthenticated } from '@services/backendApi'
import { logger } from '@shared/toolkit/LogEngine'

/** 单条通知 */
export interface UserNotificationItem {
  id: string
  type: string
  title: string
  content: string | null
  metadata: Record<string, unknown> | null
  isRead: boolean
  createdAt: string
}

/** 通知类型常量（与后端 NotificationType 保持一致） */
export const NOTIFICATION_TYPES = {
  SUBSCRIPTION_EXPIRING: 'subscription_expiring',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  SCENARIO_EXPIRING: 'scenario_expiring',
  SCENARIO_EXPIRED: 'scenario_expired',
  PLUGIN_EXPIRING: 'plugin_expiring',
  PLUGIN_EXPIRED: 'plugin_expired',
  PAYMENT_SUCCESS: 'payment_success',
  SYSTEM: 'system',
} as const

/** 场景相关通知（「工作场景」入口角标口径） */
export const SCENARIO_NOTIFICATION_TYPES: string[] = [
  NOTIFICATION_TYPES.SCENARIO_EXPIRING,
  NOTIFICATION_TYPES.SCENARIO_EXPIRED,
]

/** 插件相关通知（「插件与技能」入口角标口径） */
export const PLUGIN_NOTIFICATION_TYPES: string[] = [
  NOTIFICATION_TYPES.PLUGIN_EXPIRING,
  NOTIFICATION_TYPES.PLUGIN_EXPIRED,
]

/** 套餐（订阅）相关通知（「费用中心」入口角标口径） */
export const SUBSCRIPTION_NOTIFICATION_TYPES: string[] = [
  NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING,
  NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
]

/** 视觉分类：到期预警 / 已过期 / 成功 / 一般信息 */
export type NotificationLevel = 'warning' | 'error' | 'success' | 'info'

/** 通知类型 → 视觉分类（消息中心图标与配色） */
export function classifyNotification(type: string): NotificationLevel {
  if (type.endsWith('_expiring')) return 'warning'
  if (type.endsWith('_expired')) return 'error'
  if (type === NOTIFICATION_TYPES.PAYMENT_SUCCESS) return 'success'
  return 'info'
}

/** 轮询间隔 */
const POLL_INTERVAL_MS = 60_000

/** 一次拉取的最大条数（未读提醒量级很低，50 足够覆盖并用于角标统计） */
const FETCH_LIMIT = 50

interface UserNotificationState {
  /** 当前展示的通知列表 */
  items: UserNotificationItem[]
  /** 全量未读数（来自后端，不受分页影响） */
  unreadCount: number
  loading: boolean
  loaded: boolean
  /** 当前列表是否包含已读历史 */
  includeRead: boolean
  /** 拉取通知 */
  fetch: (options?: { includeRead?: boolean; silent?: boolean }) => Promise<void>
  /** 标记单条已读 */
  markRead: (id: string) => Promise<void>
  /** 全部标记已读 */
  markAllRead: () => Promise<void>
  /** 登出 / 切换账号时清空，避免角标残留 */
  reset: () => void
}

export const useUserNotificationStore = create<UserNotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  loaded: false,
  includeRead: false,

  fetch: async (options = {}) => {
    // 未登录时不请求后端，直接清空（否则会残留上一账号的未读角标）
    if (!isAuthenticated()) {
      set({ items: [], unreadCount: 0, loaded: true })
      return
    }

    const includeRead = options.includeRead ?? get().includeRead
    if (!options.silent) set({ loading: true })

    try {
      const query = includeRead
        ? `page=1&limit=${FETCH_LIMIT}`
        : `unreadOnly=true&limit=${FETCH_LIMIT}`
      const result = await backendApi.get<{
        items: UserNotificationItem[]
        unreadCount: number
      }>(`/api/v1/payment/notifications?${query}`)

      set({
        items: result?.items ?? [],
        unreadCount: result?.unreadCount ?? 0,
        includeRead,
        loaded: true,
      })
    } catch (err) {
      // 网络异常不打断 UI：保留上一次数据，仅记录日志
      logger.system.debug(
        '[UserNotification] 拉取通知失败：',
        err instanceof Error ? err.message : String(err),
      )
      set({ loaded: true })
    } finally {
      if (!options.silent) set({ loading: false })
    }
  },

  markRead: async (id) => {
    const target = get().items.find((item) => item.id === id)
    if (!target || target.isRead) return

    // 乐观更新：先改本地再请求，避免点一下等半天
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, isRead: true } : item,
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }))

    try {
      await backendApi.post(`/api/v1/payment/notifications/${id}/read`, {})
    } catch (err) {
      logger.system.debug(
        '[UserNotification] 标记已读失败：',
        err instanceof Error ? err.message : String(err),
      )
      // 失败则回滚本地状态，下次轮询会重新纠正
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? { ...item, isRead: false } : item,
        ),
        unreadCount: state.unreadCount + 1,
      }))
    }
  },

  markAllRead: async () => {
    const previousItems = get().items
    const previousCount = get().unreadCount
    if (previousCount === 0) return

    set((state) => ({
      items: state.items.map((item) => ({ ...item, isRead: true })),
      unreadCount: 0,
    }))

    try {
      await backendApi.post('/api/v1/payment/notifications/read-all', {})
    } catch (err) {
      logger.system.debug(
        '[UserNotification] 全部已读失败：',
        err instanceof Error ? err.message : String(err),
      )
      set({ items: previousItems, unreadCount: previousCount })
    }
  },

  reset: () => set({ items: [], unreadCount: 0, loaded: false, includeRead: false }),
}))

/** 获取某个通知类型的未读数量（入口角标用） */
export function selectUnreadCountByTypes(
  state: UserNotificationState,
  types?: string[],
): number {
  if (!types || types.length === 0) return state.unreadCount
  return state.items.filter((item) => !item.isRead && types.includes(item.type)).length
}

// ─── 轮询（模块级单例，多个组件调用也只会有一个定时器） ─────────────

let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * 启动通知轮询（幂等）
 *
 * 登录后调用：立即拉一次，之后每 60s 拉一次未读通知。
 * 未登录时不会发起请求（store.fetch 内部已判断）。
 */
export function startUserNotificationPolling(): void {
  if (pollTimer) return

  void useUserNotificationStore.getState().fetch({ silent: true })

  pollTimer = setInterval(() => {
    void useUserNotificationStore.getState().fetch({ silent: true })
  }, POLL_INTERVAL_MS)
}

/** 停止轮询（登出时调用） */
export function stopUserNotificationPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  useUserNotificationStore.getState().reset()
}
