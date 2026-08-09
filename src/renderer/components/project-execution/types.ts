/**
 * 项目执行窗口 — 类型定义
 */

/** 批量执行中的任务上下文（用于 AI 完成后自动推进下一个任务） */
export interface ExecutionTaskContext {
  /** 按执行顺序排列的任务 ID 列表 */
  taskIds: string[]
  /** 当前正在执行的任务在 taskIds 中的索引 */
  currentIndex: number
  /** 执行模式：单任务 / 批量 */
  kind: 'task' | 'batch'
}

/** 执行窗口 Tab（每个项目一个 Tab） */
export interface ExecutionTab {
  /** Tab 唯一 ID（通常用 sessionId 或 threadId） */
  id: string
  /** 项目 ID */
  projectId: string
  /** 项目名称 */
  projectName: string
  /** 执行会话 ID */
  sessionId: string
  /** 对话线程 ID */
  threadId: string
  /** 初始任务消息（执行窗口打开后自动发送给 AI 的首条消息） */
  initialMessage?: string
  /** 是否静默注入（不显示为用户消息气泡，但仍发送给 LLM） */
  silent?: boolean
  /** 任务执行上下文（批量执行时用于自动推进下一个任务 + 同步任务状态） */
  taskContext?: ExecutionTaskContext
}
