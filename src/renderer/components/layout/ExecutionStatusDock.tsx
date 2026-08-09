/**
 * ExecutionStatusDock — 执行状态推送器（无 UI）
 *
 * 订阅全局执行会话状态，当有项目任务执行时，
 * 通过 IPC 将执行状态摘要推送到悬浮球窗口，
 * 由悬浮球窗口在球体上方渲染 Pill 状态条。
 *
 * 本组件不渲染任何 UI（返回 null），
 * 实际 UI 由 AvatarExecutionStatus 在悬浮球窗口中渲染。
 */
import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import type { ExecutionStatusSummary } from '../../types/electronBridge'

/** 完成的会话自动隐藏延迟（ms） */
const COMPLETED_HIDE_DELAY = 10_000

export function ExecutionStatusDock() {
  // 订阅原始状态（引用稳定）
  const executionSessions = useStore((s) => s.executionSessions)
  const executionSessionOrder = useStore((s) => s.executionSessionOrder)

  // 派生执行状态摘要并推送到悬浮球窗口
  useEffect(() => {
    const now = Date.now()
    const activeStatuses = ['running', 'queued']
    const visibleSessions: ExecutionStatusSummary['sessions'] = []

    let runningCount = 0
    let queuedCount = 0

    for (const id of executionSessionOrder) {
      const s = executionSessions[id]
      if (!s) continue

      // 活跃会话总是包含
      if (activeStatuses.includes(s.status)) {
        if (s.status === 'running') runningCount++
        else queuedCount++

        visibleSessions.push({
          id: s.id,
          projectName: s.projectName,
          status: s.status,
          kind: s.kind,
          batchTotal: s.batchTotal,
          batchCompleted: s.batchCompleted,
        })
        continue
      }

      // 已完成的会话在延迟内仍包含
      if (s.finishedAt && now - s.finishedAt < COMPLETED_HIDE_DELAY) {
        visibleSessions.push({
          id: s.id,
          projectName: s.projectName,
          status: s.status,
          kind: s.kind,
          batchTotal: s.batchTotal,
          batchCompleted: s.batchCompleted,
        })
      }
    }

    // ⚠️ 执行窗口存在时（含最小化状态），由执行窗口自己推送状态到悬浮球，
    //    主窗口不再推送，避免覆盖执行窗口的状态（执行窗口最小化后仍持续推送）
    if (visibleSessions.length === 0) {
      // 无可见会话：仍需检查执行窗口是否在运行，避免覆盖其状态
      api.projectExecution.exists().then((executionWindowExists) => {
        if (!executionWindowExists) {
          api.floatingAvatar.pushExecutionStatus(null)
        }
      })
      return
    }

    // 有限制最多 5 个会话
    const summary: ExecutionStatusSummary = {
      activeCount: runningCount + queuedCount,
      runningCount,
      queuedCount,
      sessions: visibleSessions.slice(0, 5),
    }

    // 有活跃会话时也要检查执行窗口：若执行窗口存在则由它推送，主窗口不覆盖
    api.projectExecution.exists().then((executionWindowExists) => {
      if (!executionWindowExists) {
        api.floatingAvatar.pushExecutionStatus(summary)
      }
    })
  }, [executionSessions, executionSessionOrder])

  // 本组件不渲染任何 UI
  return null
}
