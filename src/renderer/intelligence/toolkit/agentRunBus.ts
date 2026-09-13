/**
 * 外部智能体运行事件总线（渲染进程内）
 *
 * 背景：external_agent_delegate 工具执行器在 start() 后持有 requestId，
 * 但 requestId 只有工具执行结束（meta 合并进 arguments._meta）后才对卡片可见。
 * 为让「运行中」的聊天卡片实时渲染进度，执行器在 start() 成功后通过本总线
 * 按 toolCallId 广播一次 run-started 事件，卡片侧按 toolCallId（或 agent+task）
 * 匹配拿到 requestId，再订阅主进程 external-agent:stream:{requestId} 频道。
 */
import { useEffect, useState } from 'react'

/** 运行启动事件（由工具执行器发布） */
export interface AgentRunStart {
  /** 发起该运行的工具调用 ID（ctx.toolCallId，缺省为空串） */
  toolCallId: string
  /** 主进程生成的运行请求 ID（推流频道 = external-agent:stream:{requestId}） */
  requestId: string
  agent: string
  task: string
  /** 发布时间戳 */
  at: number
}

type Listener = (detail: AgentRunStart) => void

const listeners = new Set<Listener>()
/** toolCallId → 最近一次启动（有界，避免长会话无限增长） */
const byToolCall = new Map<string, AgentRunStart>()
const MAX_ENTRIES = 64

/** 发布一次运行启动（工具执行器侧调用） */
export function publishAgentRunStart(detail: AgentRunStart): void {
  if (detail.toolCallId) {
    byToolCall.set(detail.toolCallId, detail)
    while (byToolCall.size > MAX_ENTRIES) {
      const firstKey = byToolCall.keys().next().value
      if (firstKey === undefined) break
      byToolCall.delete(firstKey)
    }
  }
  for (const listener of listeners) {
    try {
      listener(detail)
    } catch {
      /* 监听器异常不影响其他监听器 */
    }
  }
}

/**
 * 查找卡片对应的运行：
 * 1) toolCallId 精确匹配（执行器发布时携带）
 * 2) agent + task 兜底匹配（toolCallId 缺失的场景）
 */
export function findAgentRunStart(
  toolCallId: string | undefined,
  agent?: string,
  task?: string,
): AgentRunStart | null {
  if (toolCallId) {
    const hit = byToolCall.get(toolCallId)
    if (hit) return hit
  }
  if (!agent) return null
  const needle = task || ''
  for (const entry of byToolCall.values()) {
    if (entry.agent === agent && needle && entry.task === needle) return entry
  }
  return null
}

/**
 * 卡片侧 Hook：解析当前工具调用绑定的 requestId。
 * - 优先 _meta.requestId（工具执行完成后的持久化值）
 * - 运行中经总线按 toolCallId / agent+task 匹配（实时值）
 */
export function useAgentRunRequestId(
  toolCallId: string | undefined,
  metaRequestId: string | undefined,
  agent?: string,
  task?: string,
): string {
  const [busRequestId, setBusRequestId] = useState<string>(() => {
    if (metaRequestId) return metaRequestId
    return findAgentRunStart(toolCallId, agent, task)?.requestId || ''
  })

  useEffect(() => {
    if (metaRequestId) {
      setBusRequestId(metaRequestId)
      return
    }
    const listener = (detail: AgentRunStart) => {
      const isMine =
        (toolCallId && detail.toolCallId === toolCallId) ||
        (!detail.toolCallId && agent && detail.agent === agent && (!task || detail.task === task))
      if (isMine) setBusRequestId(detail.requestId)
    }
    listeners.add(listener)
    // 订阅时补一次历史匹配（卡片晚于发布事件挂载的场景）
    const missed = findAgentRunStart(toolCallId, agent, task)
    if (missed?.requestId) setBusRequestId(missed.requestId)
    return () => {
      listeners.delete(listener)
    }
  }, [toolCallId, metaRequestId, agent, task])

  return metaRequestId || busRequestId
}
