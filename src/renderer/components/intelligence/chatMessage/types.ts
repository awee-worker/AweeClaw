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
