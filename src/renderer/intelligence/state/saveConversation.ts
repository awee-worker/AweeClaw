/**
 * 语音对话历史保存共享工具
 *
 * 主窗口 VoiceConversationOverlay 与头像窗口（经 IPC 转发回主窗口）共用。
 *
 * 背景：头像窗口作为轻量独立 renderer，不导入 @store/@intelligence/toolkit，
 * 对话完成后通过 IPC 将 {userText, aiText, toolCallRecords} 发回主窗口，
 * 主窗口接收后调用本工具写入 IntelligenceStore 聊天历史。
 *
 * 主窗口自身的 VoiceConversationOverlay 也直接调用本工具（省去 IPC 中转）。
 */

import { useAgentStore } from '@intelligence/state/IntelligenceStore'

/** 工具调用记录（语音对话中执行的工具，用于回填到聊天历史） */
export interface VoiceToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  success: boolean
  resultSummary: string
}

/** 语音对话保存参数 */
export interface SaveVoiceConversationParams {
  /** 用户说的话（STT 转写文本） */
  userText: string
  /** AI 回复全文 */
  aiText: string
  /** 工具调用记录（头像窗口轻量对话无工具时为空数组/undefined） */
  toolCallRecords?: VoiceToolCallRecord[]
}

/**
 * 将一轮语音对话保存到聊天历史
 *
 * 流程：
 * 1. addUserMessage(userText) —— 写入用户消息
 * 2. addAssistantMessage(aiText) —— 写入 AI 消息，返回 messageId
 * 3. 回填 toolCallRecords（如有）—— addToolCallPart + addToolResult
 * 4. finalizeAssistant(messageId) —— 标记 AI 消息完成
 *
 * @param params 对话内容
 * @returns assistantMessageId（写入失败时为 null）
 */
export function saveVoiceConversationToHistory(
  params: SaveVoiceConversationParams,
): string | null {
  const { userText, aiText, toolCallRecords } = params
  try {
    const store = useAgentStore.getState()
    store.addUserMessage(userText)
    const assistantId = store.addAssistantMessage(aiText)

    if (assistantId && toolCallRecords && toolCallRecords.length > 0) {
      for (const record of toolCallRecords) {
        store.addToolCallPart(assistantId, {
          id: record.id,
          name: record.name,
          arguments: record.args,
        })
        store.addToolResult(
          record.id,
          record.name,
          record.resultSummary,
          record.success ? 'success' : 'tool_error',
          record.args,
        )
      }
    }

    if (assistantId) {
      store.finalizeAssistant(assistantId)
    }

    return assistantId
  } catch (err) {
    console.error('[saveVoiceConversation] Save conversation to history failed:', err)
    return null
  }
}
