/**
 * 工具结果 → 模型消息 的打包规则
 *
 * 三通道分离的最后一道闸：`record`（截屏帧、内部编号映射）与 `screenElements`
 * 的原始形态都不该进上下文 —— 前者是排查用的，后者应先算差异。
 *
 * 单独抽成函数而不是散在循环里，是为了能用一条单测守住：
 * 「record 字段永远不出现在发给模型的消息上」。
 *
 * @module protocols/toolMessagePayload
 */

/** 进模型的最小字段集 */
export interface ToolMessagePayload {
  role: 'tool'
  tool_call_id: string
  name: string
  content: string
}

/** 工具结果的模型可见部分 */
export interface ModelVisibleToolResult {
  content: string
  /** 存在但不会被带进消息；声明在这里是为了在类型上显式提醒调用方 */
  record?: Record<string, unknown>
  changed?: boolean | null
  screenElements?: unknown[]
}

/**
 * 构造发给模型的工具消息
 *
 * 刻意逐字段赋值，而不是展开整份结果：新增字段默认不进上下文，
 * 要进必须在这里显式加，避免「不小心把调试数据喂给模型」。
 */
export function buildToolMessagePayload(
  toolCallId: string,
  toolName: string,
  result: ModelVisibleToolResult,
): ToolMessagePayload {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    name: toolName,
    content: result.content,
  }
}
