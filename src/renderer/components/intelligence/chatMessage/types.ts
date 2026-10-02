/**
 * 聊天消息组件类型定义
 */
import type { AssistantPart, ToolCall, TodoItem } from '@intelligence/providerTypes'
import type { ToolStreamingPreview } from '@protocols'

/** 消息渲染上下文，传递给各 Part 渲染器 */
export interface PartRenderContext {
  pendingToolId?: string
  pendingToolIds?: string[]
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  /**
   * 该 Part 是否仍是消息时间线上的活跃尾部
   *
   * 只有仍在接收增量的最后一个渲染单元才需要平滑推进；一旦它后面渲染出了新的
   * 正文 / 思考 / 工具卡，内容即已定型，必须立即补全显示，否则会出现「后面的
   * 内容已经出现、前面的文字还在慢慢补」的重叠窗口，观感就是会话内容上下跳动。
   */
  isActiveTail?: boolean
  messageId: string
}

/** Part 渲染策略签名 */
export type PartRenderer = (part: AssistantPart, ctx: PartRenderContext) => React.ReactNode | null

/** 助手消息分组项 */
export type AssistantGroupItem =
  | { type: 'part'; part: AssistantPart; index: number }
  | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number }
  | { type: 'todo_list'; todos: TodoItem[]; index: number }

/** 流式阶段指示器属性 */
export interface StreamingPhaseProps {
  mode: 'waiting' | 'inline'
  waitPhase?: string
  streamStartTime?: number
  streamDetail?: string
  retryAttempt?: number
  retryDelay?: number
  hasReasoningBlock?: boolean
}

/** 消息流状态快照 */
export interface MessageStreamState {
  isStreaming: boolean
  liveParts?: AssistantPart[]
  liveInteractive?: any
  previewMap: Record<string, ToolStreamingPreview>
  waitPhase?: string
  streamStartTime?: number
  retryAttempt?: number
  retryDelay?: number
  streamDetail?: string
}
