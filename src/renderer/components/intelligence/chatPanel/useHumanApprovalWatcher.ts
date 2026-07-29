/**
 * 人工审批监听 Hook（Graph Runtime 阶段四 HITL）
 *
 * 职责：
 * - 订阅 task:awaiting_approval 事件，捕获 human 节点暂停
 * - 订阅 task:approval_resumed 事件，清理已决议的审批
 * - 挂载时查询 getPendingHumanApproval() 恢复已存在的待审批状态（应对组件重挂载）
 * - 暴露 resume(approved, feedback?) 调用 resumeHumanNode 恢复执行
 *
 * 与现有工具审批（useAgentViewState.isAwaitingApproval）的区别：
 * - 工具审批：ReAct 循环中单个工具调用授权（requiresApprovalGate）
 * - 本 Hook：图执行命中 human 节点后的整节点级人工决议
 *
 * @module intelligence/chatPanel
 */
import { useEffect, useState, useCallback } from 'react'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { resumeHumanNode, getPendingHumanApproval } from '@intelligence/planner'
import { logger } from '@toolkit/LogEngine'

/** 当前待审批节点信息 */
export interface HumanApprovalInfo {
  planId: string
  nodeId: string
}

/** Hook 返回值 */
export interface UseHumanApprovalWatcherResult {
  /** 当前待审批节点（null 表示无） */
  awaitingApproval: HumanApprovalInfo | null
  /**
   * 恢复执行：approved=true 通过，false 拒绝；feedback 可选反馈
   * @returns 是否成功提交（失败时调用方可回滚 UI 状态允许重试）
   */
  resume: (approved: boolean, feedback?: string) => Promise<boolean>
  /** 恢复中状态（用于禁用按钮防重复点击） */
  isResuming: boolean
}

/**
 * 监听 Graph Runtime human 节点的 HITL 审批事件
 *
 * 用法：
 * ```tsx
 * const { awaitingApproval, resume, isResuming } = useHumanApprovalWatcher()
 * {awaitingApproval && <HumanApprovalCard info={awaitingApproval} onResume={resume} isResuming={isResuming} />}
 * ```
 */
export function useHumanApprovalWatcher(): UseHumanApprovalWatcherResult {
  const [awaitingApproval, setAwaitingApproval] = useState<HumanApprovalInfo | null>(null)
  const [isResuming, setIsResuming] = useState(false)

  useEffect(() => {
    // 初始查询：恢复组件重挂载前已存在的待审批（如切换会话后回归）
    const pending = getPendingHumanApproval()
    if (pending) {
      setAwaitingApproval({ planId: pending.planId, nodeId: pending.nodeId })
    }

    // 订阅 human 节点暂停事件
    const unsubAwaiting = EventBus.subscribe('task:awaiting_approval', event => {
      logger.agent.info(
        `[HITL] Awaiting approval for node ${event.taskId} (plan ${event.planId})`,
      )
      setAwaitingApproval({ planId: event.planId, nodeId: event.taskId })
    })

    // 订阅审批决议事件：清理状态（无论通过/拒绝）
    const unsubResumed = EventBus.subscribe('task:approval_resumed', event => {
      logger.agent.info(
        `[HITL] Approval resumed for node ${event.taskId} (approved=${event.approved})`,
      )
      setAwaitingApproval(null)
    })

    return () => {
      unsubAwaiting()
      unsubResumed()
    }
  }, [])

  /**
   * 恢复执行
   * - 防重复点击：isResuming 期间忽略后续调用
   * - 成功后由 task:approval_resumed 事件清理 awaitingApproval
   * - 失败时返回 false，调用方据此回滚 UI 状态允许重试
   *
   * @returns 是否成功提交决议
   */
  const resume = useCallback(
    async (approved: boolean, feedback?: string): Promise<boolean> => {
      if (!awaitingApproval) return false
      if (isResuming) return false

      setIsResuming(true)
      try {
        const result = await resumeHumanNode(
          awaitingApproval.planId,
          awaitingApproval.nodeId,
          approved,
          feedback,
        )
        if (!result.success) {
          logger.agent.warn(`[HITL] Resume failed: ${result.message}`)
          return false
        }
        return true
      } catch (err) {
        logger.agent.error('[HITL] Resume threw error:', err)
        return false
      } finally {
        setIsResuming(false)
      }
    },
    [awaitingApproval, isResuming],
  )

  return { awaitingApproval, resume, isResuming }
}
