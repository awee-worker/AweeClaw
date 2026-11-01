/**
 * critical 撤销窗口订阅 Hook（阶段10 P2 改造三）
 *
 * 职责：
 * 1. 订阅主进程 'proactive:critical-pending' 频道（critical 级撤销窗口开启）
 * 2. 维护窗口列表与其到期时间，供确认条渲染倒计时
 * 3. 提供 confirm(proposalId) / cancel(proposalId)
 *    - confirm → 立即执行（主进程清掉定时器后下发 execute-action）
 *    - cancel  → 撤销并上报 rejected 反馈（驱动信任等级回退）
 *
 * 与 useProactiveInvoker 的分工：
 * - useProactiveInvoker 订阅 'proactive:execute-action'，负责「真正执行」
 * - 本 Hook 只负责窗口展示与两个出口，不直接执行动作
 *
 * 数据流：
 *   ProactiveActionTrigger.scheduleCriticalWithUndo()
 *     → webContents.send('proactive:critical-pending', { ..., windowMs })
 *     → useProactiveCriticalWindow (本 Hook)
 *     → ProactiveCriticalUndoBar 渲染倒计时
 *     → 用户点「立即执行」→ confirmCritical
 *     → 用户点「撤销」    → cancelCritical + recordFeedback('rejected')
 *     → 未操作          → 主进程定时器到期后自动执行 execute-action
 *
 * @module intelligence/proactive/useProactiveCriticalWindow
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '@toolkit/LogEngine'

/** 'proactive:critical-pending' 频道载荷 */
export interface CriticalPendingPayload {
  proposalId: string
  action: {
    type: 'notify' | 'suggest' | 'chat' | 'execute'
    payload: string
  }
  source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
  title: string
  reason: string
  /** 撤销窗口时长（ms） */
  windowMs: number
}

/** 确认条上的一条窗口记录 */
export interface CriticalWindowItem {
  proposalId: string
  title: string
  reason: string
  source: CriticalPendingPayload['source']
  action: CriticalPendingPayload['action']
  /** 窗口总时长（ms），用于算进度百分比 */
  windowMs: number
  /** 窗口到期时间戳（ms） */
  expiresAt: number
  /**
   * 终态提示：撤销时窗口已过期，动作已经执行出去了
   * 短暂展示后自动移除，避免让用户以为撤销成功
   */
  settled?: 'executed'
}

/** 撤销成功后短暂保留终态提示的时长（ms） */
const SETTLED_LINGER_MS = 1500

/** 过期扫描间隔（ms） */
const EXPIRE_SCAN_MS = 250

/** electronAPI.proactive 的最小可用子集 */
interface ProactiveBridge {
  onCriticalPending?: (callback: (payload: CriticalPendingPayload) => void) => () => void
  confirmCritical?: (
    proposalId: string,
  ) => Promise<{ success: boolean; data?: { applied: boolean }; error?: string }>
  cancelCritical?: (
    proposalId: string,
    reason?: string,
  ) => Promise<{ success: boolean; data?: { applied: boolean }; error?: string }>
  recordFeedback?: (
    proposalId: string,
    feedback: string,
    actualAction?: string,
  ) => Promise<unknown>
}

/** 取渲染层的 proactive 桥接对象（未注入时返回 undefined） */
function getBridge(): ProactiveBridge | undefined {
  return (window as Window & { electronAPI?: { proactive?: ProactiveBridge } }).electronAPI
    ?.proactive
}

export interface UseProactiveCriticalWindowResult {
  /** 当前处于撤销窗口内的提案，按到达顺序排列 */
  windows: CriticalWindowItem[]
  /** 立即执行（窗口内确认） */
  confirm: (proposalId: string) => void
  /** 撤销并记录拒绝反馈 */
  cancel: (proposalId: string) => void
}

/**
 * 订阅 critical 撤销窗口
 *
 * 应在 ChatPanel 顶层调用一次，声明周期与聊天面板一致。
 */
export function useProactiveCriticalWindow(): UseProactiveCriticalWindowResult {
  const [windows, setWindows] = useState<CriticalWindowItem[]>([])

  /** 已在处理中的 proposalId，防止连点造成重复 IPC */
  const inflightRef = useRef<Set<string>>(new Set())

  /** 终态提示的移除定时器（卸载时统一清理） */
  const lingerTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeItem = useCallback((proposalId: string) => {
    setWindows((prev) => prev.filter((item) => item.proposalId !== proposalId))
  }, [])

  // ============================================================
  // 订阅 'proactive:critical-pending'
  // ============================================================
  useEffect(() => {
    const bridge = getBridge()
    if (!bridge?.onCriticalPending) {
      logger.proactive?.warn(
        '[useProactiveCriticalWindow] proactive.onCriticalPending API 不可用',
      )
      return
    }

    const unsubscribe = bridge.onCriticalPending((payload) => {
      if (!payload?.proposalId || !payload.title) {
        logger.proactive?.warn('[useProactiveCriticalWindow] 收到无效窗口载荷:', payload)
        return
      }

      const windowMs = Number.isFinite(payload.windowMs) ? Math.max(0, payload.windowMs) : 0
      // 窗口时长为 0 表示主进程已关闭该能力，不会等我们确认
      if (windowMs === 0) {
        logger.proactive?.debug(
          `[useProactiveCriticalWindow] 窗口时长为 0，不展示确认条: ${payload.proposalId}`,
        )
        return
      }

      setWindows((prev) => {
        if (prev.some((item) => item.proposalId === payload.proposalId)) return prev
        const next: CriticalWindowItem[] = [
          ...prev,
          {
            proposalId: payload.proposalId,
            title: payload.title,
            reason: payload.reason ?? '',
            source: payload.source,
            action: payload.action,
            windowMs,
            expiresAt: Date.now() + windowMs,
          },
        ]
        // 同屏最多 3 条，超出时最早的窗口已经接近到期，直接丢掉
        return next.length > 3 ? next.slice(next.length - 3) : next
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // ============================================================
  // 到期清理：主进程此时已自动执行，条不能再留在屏幕上
  // ============================================================
  useEffect(() => {
    if (windows.length === 0) return

    const timer = setInterval(() => {
      const now = Date.now()
      setWindows((prev) => {
        const expired = prev.filter((item) => item.expiresAt <= now)
        if (expired.length === 0) return prev
        for (const item of expired) {
          logger.proactive?.info(
            `[useProactiveCriticalWindow] 撤销窗口到期，动作已自动执行: ${item.proposalId}`,
          )
        }
        return prev.filter((item) => item.expiresAt > now)
      })
    }, EXPIRE_SCAN_MS)

    return () => {
      clearInterval(timer)
    }
  }, [windows.length])

  // ============================================================
  // 立即执行
  // ============================================================
  const confirm = useCallback(
    (proposalId: string) => {
      if (inflightRef.current.has(proposalId)) return
      inflightRef.current.add(proposalId)

      // 先移除：用户已经做了决定，条不该继续倒计时
      removeItem(proposalId)

      const bridge = getBridge()
      if (!bridge?.confirmCritical) {
        logger.proactive?.warn('[useProactiveCriticalWindow] confirmCritical API 不可用')
        inflightRef.current.delete(proposalId)
        return
      }

      void bridge
        .confirmCritical(proposalId)
        .then((res) => {
          if (res?.success && res.data?.applied) {
            logger.proactive?.info(
              `[useProactiveCriticalWindow] 用户提前执行 critical 动作: ${proposalId}`,
            )
          } else {
            // 窗口刚好过期，主进程已按默认路径执行，结果一致，仅记录
            logger.proactive?.info(
              `[useProactiveCriticalWindow] 确认未命中待执行窗口（可能已到期执行）: ${proposalId}`,
            )
          }
        })
        .catch((err) => {
          logger.proactive?.error(
            `[useProactiveCriticalWindow] confirmCritical 调用失败: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        })
        .finally(() => {
          inflightRef.current.delete(proposalId)
        })
    },
    [removeItem],
  )

  // ============================================================
  // 撤销
  // ============================================================
  const cancel = useCallback(
    (proposalId: string) => {
      if (inflightRef.current.has(proposalId)) return
      inflightRef.current.add(proposalId)

      const bridge = getBridge()
      if (!bridge?.cancelCritical) {
        logger.proactive?.warn('[useProactiveCriticalWindow] cancelCritical API 不可用')
        inflightRef.current.delete(proposalId)
        return
      }

      void bridge
        .cancelCritical(proposalId, 'user_undo')
        .then(async (res) => {
          const applied = res?.success === true && res.data?.applied === true

          if (!applied) {
            // 窗口已过期，动作已经执行出去了：如实告诉用户，而不是装作撤销成功
            logger.proactive?.warn(
              `[useProactiveCriticalWindow] 撤销失败，窗口已过期且动作已执行: ${proposalId}`,
            )
            setWindows((prev) =>
              prev.map((item) =>
                item.proposalId === proposalId ? { ...item, settled: 'executed' } : item,
              ),
            )
            const timer = setTimeout(() => {
              removeItem(proposalId)
              lingerTimersRef.current.delete(proposalId)
            }, SETTLED_LINGER_MS)
            lingerTimersRef.current.set(proposalId, timer)
            return
          }

          removeItem(proposalId)
          logger.proactive?.info(
            `[useProactiveCriticalWindow] 用户撤销 critical 动作: ${proposalId}`,
          )

          // 信任回退由反馈驱动，与卡片上的「拒绝」走同一条链路
          if (bridge.recordFeedback) {
            try {
              await bridge.recordFeedback(proposalId, 'rejected', 'undo_window')
            } catch (err) {
              logger.proactive?.warn(
                `[useProactiveCriticalWindow] 上报 rejected 反馈失败: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              )
            }
          }
        })
        .catch((err) => {
          logger.proactive?.error(
            `[useProactiveCriticalWindow] cancelCritical 调用失败: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        })
        .finally(() => {
          inflightRef.current.delete(proposalId)
        })
    },
    [removeItem],
  )

  // ============================================================
  // 卸载清理
  // ============================================================
  useEffect(() => {
    const timers = lingerTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  return { windows, confirm, cancel }
}
